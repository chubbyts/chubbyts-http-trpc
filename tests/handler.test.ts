import { describe, expect, test, vi } from 'vitest';
import { initTRPC, TRPCError } from '@trpc/server';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/function-mock';
import {
  createBodyFactory,
  createResponseFactory,
  createServerRequestFactory,
} from '@chubbyts/chubbyts-http/message-factory';
import {
  createResponseHelpers,
  createServerRequestHelpers,
  createUriHelpers,
} from '@chubbyts/chubbyts-http/message-helper';
import {
  createFetchResponseToResponseFactory,
  createRequestToFetchRequestFactory,
} from '@chubbyts/chubbyts-http-fetch/fetch';
import type { FetchResponseToResponse, RequestToFetchRequest } from '@chubbyts/chubbyts-http-fetch/fetch';
import type { Body, Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { TrpcCreateContextFnOptions } from '../src/handler.js';
import { createTrpcHandler } from '../src/handler.js';

const bodyFactory = createBodyFactory();
const serverRequestFactory = createServerRequestFactory();
const serverRequestHelpers = createServerRequestHelpers();
const uriHelpers = createUriHelpers();
const responseFactory = createResponseFactory();
const responseHelpers = createResponseHelpers();
const requestToFetchRequest = createRequestToFetchRequestFactory(uriHelpers);
const fetchResponseToResponse = createFetchResponseToResponseFactory(responseFactory, responseHelpers);

const bodyToString = async (body: Body): Promise<string> => {
  const decoder = new TextDecoder();

  // oxlint-disable-next-line functional/no-let
  let content = '';

  for await (const chunk of body) {
    content += decoder.decode(chunk, { stream: true });
  }

  return content + decoder.decode();
};

type Context = { user: string | undefined };

const t = initTRPC.context<Context>().create();

const tWithoutContext = initTRPC.create();

const router = t.router({
  greet: t.procedure
    .input((value: unknown) => {
      if (typeof value !== 'string') {
        throw new Error('Expected a string');
      }

      return value;
    })
    .query(({ input }) => `Hello ${input}`),
  whoami: t.procedure.query(({ ctx }) => ctx.user ?? null),
  add: t.procedure
    .input((value: unknown) => value as { a: number; b: number })
    .mutation(({ input }) => input.a + input.b),
  fail: t.procedure.query(() => {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed' });
  }),
  countdown: t.procedure.query(async function* () {
    yield 2;
    yield 1;
  }),
});

const createContext = ({ req }: TrpcCreateContextFnOptions): Context => ({
  user: req.attributes['user'] as string | undefined,
});

const createHandler = (options: Partial<Parameters<typeof createTrpcHandler<typeof router>>[2]> = {}) =>
  createTrpcHandler(requestToFetchRequest, fetchResponseToResponse, {
    router,
    endpoint: '/trpc',
    createContext,
    ...options,
  });

const getRequest = (target: string): ServerRequest => serverRequestFactory('GET', `https://example.com/trpc/${target}`);

describe('createTrpcHandler', () => {
  test('query', async () => {
    const handler = createHandler();

    const response = await handler(getRequest(`greet?input=${encodeURIComponent(JSON.stringify('John'))}`));

    expect(response.status).toBe(200);
    expect(response.reasonPhrase).toBe('OK');
    expect(responseHelpers.getHeaderLine(response, 'content-type')).toBe('application/json');
    expect(JSON.parse(await bodyToString(response.body))).toEqual({ result: { data: 'Hello John' } });
  });

  test('converts through the given functions', async () => {
    const request = getRequest('whoami');

    const response: Response = responseFactory(299, 'Converted');

    const [requestToFetchRequestMock, requestToFetchRequestMocks] = useFunctionMock<RequestToFetchRequest>([
      { parameters: [request], return: new Request('https://example.com/trpc/whoami') },
    ]);

    const fetchResponseToResponseMock = vi.fn<FetchResponseToResponse>(() => response);

    const handler = createTrpcHandler(requestToFetchRequestMock, fetchResponseToResponseMock, {
      router,
      endpoint: '/trpc',
      createContext,
    });

    expect(await handler(request)).toBe(response);

    expect(requestToFetchRequestMocks).toHaveLength(0);

    expect(fetchResponseToResponseMock).toHaveBeenCalledTimes(1);

    const fetchResponse = fetchResponseToResponseMock.mock.calls[0][0];

    expect(fetchResponse.status).toBe(200);
    expect(await fetchResponse.json()).toEqual({ result: { data: null } });
  });

  test('query passes the server request attributes to the context', async () => {
    const handler = createHandler();

    const response = await handler(serverRequestHelpers.withAttribute(getRequest('whoami'), 'user', 'john'));

    expect(JSON.parse(await bodyToString(response.body))).toEqual({ result: { data: 'john' } });
  });

  test('query without createContext', async () => {
    const handler = createTrpcHandler(requestToFetchRequest, fetchResponseToResponse, {
      router: tWithoutContext.router({ ping: tWithoutContext.procedure.query(() => 'pong') }),
      endpoint: '/trpc',
    });

    const response = await handler(getRequest('ping'));

    expect(JSON.parse(await bodyToString(response.body))).toEqual({ result: { data: 'pong' } });
  });

  test('mutation with body', async () => {
    const handler = createHandler();

    const request = serverRequestHelpers.withBody(
      serverRequestHelpers.withHeader(
        serverRequestFactory('POST', 'https://example.com/trpc/add'),
        'content-type',
        'application/json',
      ),
      bodyFactory(JSON.stringify({ a: 1, b: 2 })),
    );

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(JSON.parse(await bodyToString(response.body))).toEqual({ result: { data: 3 } });
  });

  test('batch', async () => {
    const handler = createHandler();

    const input = encodeURIComponent(JSON.stringify({ 0: 'John', 1: 'Jane' }));

    const response = await handler(getRequest(`greet,greet?batch=1&input=${input}`));

    expect(response.status).toBe(200);
    expect(JSON.parse(await bodyToString(response.body))).toEqual([
      { result: { data: 'Hello John' } },
      { result: { data: 'Hello Jane' } },
    ]);
  });

  test('streamed batch', async () => {
    const handler = createHandler();

    const request = serverRequestHelpers.withHeader(
      getRequest(`countdown?batch=1&input=${encodeURIComponent(JSON.stringify({}))}`),
      'trpc-accept',
      'application/jsonl',
    );

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(responseHelpers.getHeaderLine(response, 'content-type')).toBe('application/json');
    expect(responseHelpers.getHeaderLine(response, 'transfer-encoding')).toBe('chunked');

    const lines = (await bodyToString(response.body)).trim().split('\n');

    expect(lines.length).toBeGreaterThan(1);
  });

  test('head without body', async () => {
    const handler = createHandler();

    const request = serverRequestFactory('HEAD', 'https://example.com/trpc/whoami');

    const emptyResponse = responseFactory(204);

    const response = await handler(request);

    expect(response.status).toBe(204);
    expect(response.reasonPhrase).toBe('No Content');
    expect(response.headers).toEqual({});
    // the (empty) body of the factory is kept
    expect(await bodyToString(response.body)).toBe(await bodyToString(emptyResponse.body));
  });

  test('response headers set through the context', async () => {
    const handler = createHandler({
      createContext: ({ resHeaders }) => {
        resHeaders.append('set-cookie', 'a=1; Path=/');
        resHeaders.append('set-cookie', 'b=2; Path=/');
        resHeaders.append('x-custom', 'one');
        resHeaders.append('x-custom', 'two');

        return { user: undefined };
      },
    });

    const response = await handler(getRequest('whoami'));

    // set-cookie values cannot be joined (RFC 6265 3), all other ones are joined by the fetch headers
    expect(responseHelpers.getHeader(response, 'set-cookie')).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(responseHelpers.getHeader(response, 'x-custom')).toEqual(['one, two']);
  });

  test('response meta', async () => {
    const handler = createHandler({
      responseMeta: () => ({ status: 202, headers: new Headers({ 'cache-control': 'max-age=60' }) }),
    });

    const response = await handler(getRequest('whoami'));

    expect(response.status).toBe(202);
    expect(response.reasonPhrase).toBe('Accepted');
    expect(responseHelpers.getHeader(response, 'cache-control')).toEqual(['max-age=60']);
  });

  test('error passes the server request to onError', async () => {
    const onError = vi.fn();

    const handler = createHandler({ onError });

    const request = getRequest('fail');

    const response = await handler(request);

    expect(response.status).toBe(403);
    expect(response.reasonPhrase).toBe('Forbidden');
    expect(JSON.parse(await bodyToString(response.body))).toMatchObject({
      error: { message: 'Not allowed', data: { code: 'FORBIDDEN', httpStatus: 403, path: 'fail' } },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ req: request, path: 'fail', type: 'query' });
    expect(onError.mock.calls[0][0].error).toBeInstanceOf(TRPCError);
  });

  test('error without onError', async () => {
    const handler = createHandler();

    const response = await handler(getRequest('unknown'));

    expect(response.status).toBe(404);
    expect(JSON.parse(await bodyToString(response.body))).toMatchObject({
      error: { data: { code: 'NOT_FOUND', path: 'unknown' } },
    });
  });
});
