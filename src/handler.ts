import type { AnyTRPCRouter, CreateContextCallback, inferRouterContext } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { HTTPBaseHandlerOptions, TRPCRequestInfo } from '@trpc/server/http';
import type { FetchResponseToResponse, RequestToFetchRequest } from '@chubbyts/chubbyts-http-fetch/fetch';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';
import type { Attributes, Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';

/**
 * What `createContext` gets: the server request (with the attributes set by the middlewares, e.g. an authenticated
 * user), the headers to add to the response (e.g. to set cookies) and what tRPC knows about the request.
 */
export type TrpcCreateContextFnOptions<A extends Attributes = Attributes> = {
  req: ServerRequest<A>;
  resHeaders: Headers;
  info: TRPCRequestInfo;
};

export type TrpcCreateContextFn<TRouter extends AnyTRPCRouter, A extends Attributes = Attributes> = (
  opts: TrpcCreateContextFnOptions<A>,
) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;

/**
 * The options of the tRPC fetch adapter, with the server request instead of the fetch request given to
 * `createContext` and `onError`.
 */
export type TrpcHandlerOptions<
  TRouter extends AnyTRPCRouter,
  A extends Attributes = Attributes,
> = HTTPBaseHandlerOptions<TRouter, ServerRequest<A>> &
  CreateContextCallback<inferRouterContext<TRouter>, TrpcCreateContextFn<TRouter, A>> & {
    /** The path the router is served at, such as `/trpc`, the rest of the path is the procedure path. */
    endpoint: string;
  };

/**
 * Serves a tRPC router through the fetch adapter of tRPC, the server request and the response get converted by the
 * given functions of @chubbyts/chubbyts-http-fetch.
 */
export const createTrpcHandler = <TRouter extends AnyTRPCRouter, A extends Attributes = Attributes>(
  requestToFetchRequest: RequestToFetchRequest,
  fetchResponseToResponse: FetchResponseToResponse,
  options: TrpcHandlerOptions<TRouter, A>,
): Handler<A> => {
  const { createContext, onError, ...otherOptions } = options as TrpcHandlerOptions<TRouter, A> & {
    createContext?: TrpcCreateContextFn<TRouter, A>;
  };

  return async (request: ServerRequest<A>): Promise<Response> => {
    const fetchResponse = await fetchRequestHandler<TRouter>({
      ...otherOptions,
      req: requestToFetchRequest(request),
      // the server request instead of the fetch request: it has the attributes
      createContext: createContext
        ? ({ resHeaders, info }) => createContext({ req: request, resHeaders, info })
        : undefined,
      onError: onError ? (errorOptions) => onError({ ...errorOptions, req: request }) : undefined,
    } as Parameters<typeof fetchRequestHandler<TRouter>>[0]);

    return fetchResponseToResponse(fetchResponse);
  };
};
