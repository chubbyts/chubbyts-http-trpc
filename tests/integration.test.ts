import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { initTRPC } from '@trpc/server';
import { createApplicationBuilder } from '@chubbyts/chubbyts-framework/facade';
import { createPathToRegexpMatch as createMatch } from '@chubbyts/chubbyts-framework-router-path-to-regexp/path-to-regexp-router';
import {
  createBodyFactory,
  createResponseFactory,
  createServerRequestFactory,
  createUriFactory,
} from '@chubbyts/chubbyts-http/message-factory';
import {
  createResponseHelpers,
  createServerRequestHelpers,
  createUriHelpers,
} from '@chubbyts/chubbyts-http/message-helper';
import { createCorsMiddleware } from '@chubbyts/chubbyts-http-cors/middleware';
import {
  createAllowOriginExact,
  createHeadersNegotiator,
  createMethodNegotiator,
  createOriginNegotiator,
} from '@chubbyts/chubbyts-http-cors/negotiation';
import {
  createFetchResponseToResponseFactory,
  createRequestToFetchRequestFactory,
} from '@chubbyts/chubbyts-http-fetch/fetch';
import {
  createNodeRequestToServerRequestFactory,
  createResponseToNodeResponseEmitter,
} from '@chubbyts/chubbyts-http-node/node';
import type { Middleware } from '@chubbyts/chubbyts-http-types/middleware';
import type { TrpcCreateContextFnOptions } from '../src/handler.js';
import { createTrpcHandler } from '../src/handler.js';

type Context = { user: string | undefined };

const t = initTRPC.context<Context>().create({ isDev: false });

const appRouter = t.router({
  greet: t.procedure.input((value: unknown) => String(value)).query(({ input }) => `Hello ${input}`),
  whoami: t.procedure.query(({ ctx }) => ctx.user ?? null),
  add: t.procedure
    .input((value: unknown) => value as { a: number; b: number })
    .mutation(({ input }) => input.a + input.b),
  user: t.router({
    name: t.procedure.query(({ ctx }) => ctx.user ?? null),
  }),
});

const bodyFactory = createBodyFactory();
const responseFactory = createResponseFactory();
const responseHelpers = createResponseHelpers();
const serverRequestHelpers = createServerRequestHelpers();

const trpcHandler = createTrpcHandler(
  createRequestToFetchRequestFactory(createUriHelpers()),
  createFetchResponseToResponseFactory(responseFactory, responseHelpers),
  {
    router: appRouter,
    endpoint: '/trpc',
    createContext: ({ req }: TrpcCreateContextFnOptions): Context => ({
      user: req.attributes['user'] as string | undefined,
    }),
  },
);

const allowedOrigin = 'https://app.example.com';

const corsMiddleware = createCorsMiddleware(
  responseFactory,
  responseHelpers,
  createOriginNegotiator(serverRequestHelpers, [createAllowOriginExact(allowedOrigin)]),
  createMethodNegotiator(serverRequestHelpers, ['GET', 'POST']),
  createHeadersNegotiator(serverRequestHelpers, ['content-type', 'trpc-accept']),
);

// stands for an authentication middleware: sets the attribute the context gets created from
const userMiddleware: Middleware = async (request, handler) => {
  const user = serverRequestHelpers.getHeaderLine(request, 'x-user');

  return handler(user ? serverRequestHelpers.withAttribute(request, 'user', user) : request);
};

const app = createApplicationBuilder({ createMatch, responseFactory, bodyFactory }, [corsMiddleware, userMiddleware])
  .get('/trpc{/*path}', 'trpc_get', trpcHandler)
  .post('/trpc{/*path}', 'trpc_post', trpcHandler)
  .build();

const nodeRequestToServerRequest = createNodeRequestToServerRequestFactory(
  createUriFactory(),
  createServerRequestFactory(),
  serverRequestHelpers,
  undefined,
  10_000,
  1024 * 1024,
);

const responseToNodeResponse = createResponseToNodeResponseEmitter();

const input = (value: unknown): string => encodeURIComponent(JSON.stringify(value));

describe('integration: framework, router, cors and node', () => {
  // oxlint-disable-next-line functional/no-let
  let server: Server;

  // oxlint-disable-next-line functional/no-let
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      responseToNodeResponse(await app(nodeRequestToServerRequest(req, res)), res);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  test('query', async () => {
    const response = await fetch(`${baseUrl}/trpc/greet?input=${input('John')}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ result: { data: 'Hello John' } });
  });

  test('query with the context created from an attribute set by a middleware', async () => {
    const response = await fetch(`${baseUrl}/trpc/whoami`, { headers: { 'x-user': 'john' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: 'john' } });
  });

  test('query of a nested router', async () => {
    const response = await fetch(`${baseUrl}/trpc/user.name`, { headers: { 'x-user': 'john' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: 'john' } });
  });

  test('batch query', async () => {
    const response = await fetch(`${baseUrl}/trpc/greet,whoami?batch=1&input=${input({ 0: 'John' })}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ result: { data: 'Hello John' } }, { result: { data: null } }]);
  });

  test('mutation', async () => {
    const response = await fetch(`${baseUrl}/trpc/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1, b: 2 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: 3 } });
  });

  test.each(['/trpc', '/trpc/unknown', '/trpc/greet/more'])(
    '%s reaches tRPC: not found error of tRPC',
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`);

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toMatchObject({ error: { data: { code: 'NOT_FOUND', httpStatus: 404 } } });
    },
  );

  test.each(['/', '/trpcx/greet', '/other/greet'])('%s does not reach tRPC: not found of the router', async (path) => {
    const response = await fetch(`${baseUrl}${path}?input=${input('John')}`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toBe('application/json');
  });

  test('method not allowed of the router', async () => {
    const response = await fetch(`${baseUrl}/trpc/greet?input=${input('John')}`, { method: 'PUT' });

    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).not.toBe('application/json');
  });

  test('cors preflight', async () => {
    const response = await fetch(`${baseUrl}/trpc/add`, {
      method: 'OPTIONS',
      headers: {
        origin: allowedOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,POST');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type,trpc-accept');
  });

  test('cors with an allowed origin', async () => {
    const response = await fetch(`${baseUrl}/trpc/greet?input=${input('John')}`, {
      headers: { origin: allowedOrigin },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(await response.json()).toEqual({ result: { data: 'Hello John' } });
  });

  test('cors with a not allowed origin', async () => {
    const response = await fetch(`${baseUrl}/trpc/greet?input=${input('John')}`, {
      headers: { origin: 'https://evil.example.com' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
