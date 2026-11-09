# chubbyts-http-trpc

[![CI](https://github.com/chubbyts/chubbyts-http-trpc/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/chubbyts/chubbyts-http-trpc/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/chubbyts/chubbyts-http-trpc/badge.svg?branch=master)](https://coveralls.io/github/chubbyts/chubbyts-http-trpc?branch=master)
[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fchubbyts%2Fchubbyts-http-trpc%2Fmaster)](https://dashboard.stryker-mutator.io/reports/github.com/chubbyts/chubbyts-http-trpc/master)
[![npm-version](https://img.shields.io/npm/v/@chubbyts/chubbyts-http-trpc.svg)](https://www.npmjs.com/package/@chubbyts/chubbyts-http-trpc)

[![bugs](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=bugs)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![code_smells](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=code_smells)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![coverage](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=coverage)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![duplicated_lines_density](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=duplicated_lines_density)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![ncloc](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=ncloc)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![sqale_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=sqale_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![alert_status](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=alert_status)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![reliability_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=reliability_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![security_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=security_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![sqale_index](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=sqale_index)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)
[![vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-trpc&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-trpc)

## Description

A [tRPC][3] adapter for [@chubbyts/chubbyts-http-types][2]: it serves a tRPC router as a `Handler`.

The server request gets converted into a fetch `Request` and the fetch `Response` back by [@chubbyts/chubbyts-http-fetch][8]
(it works with any implementation of the types, e.g. [@chubbyts/chubbyts-http][4]), in between the [fetch adapter][5] of
tRPC handles the request: routing, batching, streaming (`httpBatchStreamLink`, subscriptions), `responseMeta`,
`allowBatching`, `maxBatchSize` and `allowMethodOverride` behave exactly like documented by tRPC.

## Requirements

 * node: >=22
 * [@chubbyts/chubbyts-http-fetch][8]: ^1.0.0
 * [@chubbyts/chubbyts-http-types][2]: ^4.0.0
 * [@trpc/server][3]: ^11.0.0

## Installation

Through [NPM](https://www.npmjs.com) as [@chubbyts/chubbyts-http-trpc][1].

```sh
npm i @chubbyts/chubbyts-http-trpc@^1.0.0 @trpc/server@^11.0.0
```

## Usage

```ts
import { initTRPC } from '@trpc/server';
import { createResponseFactory } from '@chubbyts/chubbyts-http/message-factory';
import { createResponseHelpers, createUriHelpers } from '@chubbyts/chubbyts-http/message-helper';
import {
  createFetchResponseToResponseFactory,
  createRequestToFetchRequestFactory,
} from '@chubbyts/chubbyts-http-fetch/fetch';
import type { TrpcCreateContextFnOptions } from '@chubbyts/chubbyts-http-trpc/handler';
import { createTrpcHandler } from '@chubbyts/chubbyts-http-trpc/handler';

type Context = { user: string | undefined };

const t = initTRPC.context<Context>().create();

const appRouter = t.router({
  greet: t.procedure.input((value: unknown) => String(value)).query(({ input }) => `Hello ${input}`),
  whoami: t.procedure.query(({ ctx }) => ctx.user ?? null),
});

export type AppRouter = typeof appRouter;

const responseFactory = createResponseFactory();
const responseHelpers = createResponseHelpers();

const trpcHandler = createTrpcHandler(
  createRequestToFetchRequestFactory(createUriHelpers()),
  createFetchResponseToResponseFactory(responseFactory, responseHelpers),
  {
    router: appRouter,
    endpoint: '/trpc',
    // the server request, with the attributes set by the middlewares (e.g. an authenticated user)
    createContext: ({ req, resHeaders, info }: TrpcCreateContextFnOptions): Context => ({
      user: req.attributes['user'] as string | undefined,
    }),
    // the server request as `req`
    onError: ({ error, path, req }) => console.error(`tRPC error on '${path}'`, error),
    // responseMeta, allowBatching, maxBatchSize, allowMethodOverride
  },
);
```

The path of the server request is `endpoint` followed by the procedure path (e.g. `/trpc/greet`, `/trpc/user.get` for
a nested router or `/trpc/greet,whoami` for a batch). The uri of the server request has to be absolute (with scheme and
host), like the ones created by [@chubbyts/chubbyts-http-node][6].

`endpoint` does **not** mount the handler at that path and it is not checked against the path of the server request:
tRPC only cuts off as many characters as `endpoint` is long and takes the rest as the procedure path. The handler
answers every request it gets, so which requests reach it is up to the route it is registered with (see
[With a router](#with-a-router)), `endpoint` has to be the same prefix as the one of the route.

`createContext` is required if the router has a context (like with tRPC itself), it gets the server request as `req`,
the `resHeaders` (e.g. to set cookies) and the `info` of tRPC. `info.signal` gets aborted with the `signal` of the
server request (e.g. when the client disconnects).

Set `isDev: false` within `initTRPC.create()` in production (or run with `NODE_ENV=production`): otherwise tRPC adds the
stack trace of errors to the response.

### With a router

Register the handler with a route that matches every path below `endpoint`, for `GET` (queries,
subscriptions) and `POST` (mutations). An exact `/trpc` route would never match a procedure, because the procedure path is
part of the path.

With [@chubbyts/chubbyts-framework][9] and [@chubbyts/chubbyts-framework-router-path-to-regexp][10]:

```sh
npm i @chubbyts/chubbyts-framework@^4.2.0 @chubbyts/chubbyts-framework-router-path-to-regexp@^4.1.1
```

```ts
import { createPathToRegexpMatch as createMatch }
  from '@chubbyts/chubbyts-framework-router-path-to-regexp/path-to-regexp-router';
import { createApplicationBuilder } from '@chubbyts/chubbyts-framework/facade';
import { createBodyFactory } from '@chubbyts/chubbyts-http/message-factory';

const app = createApplicationBuilder({ createMatch, responseFactory, bodyFactory: createBodyFactory() }, [])
  // endpoint: '/trpc' => '/trpc{/*path}': '/trpc' and everything below
  .get('/trpc{/*path}', 'trpc_get', trpcHandler)
  .post('/trpc{/*path}', 'trpc_post', trpcHandler)
  .build();
```

Everything at or below `/trpc` reaches tRPC, so an unknown procedure (`/trpc`, `/trpc/unknown`, `/trpc/greet/more`)
gets answered with the `NOT_FOUND` error of tRPC, in the format the tRPC client expects. Paths outside of it
(`/trpcx/greet`, `/other/greet`) get answered by the router with a `404`, other methods with a `405`, without reaching
tRPC.

### With node and cors

Combined with [@chubbyts/chubbyts-http-node][6] and [@chubbyts/chubbyts-http-cors][7]. The request body limit of
the node adapters of tRPC (`maxBodySize`) is `requestBodyMaxBytes` of the node bridge.

Without a router in front (like here) every path gets handled by tRPC, to restrict it to `/trpc/...` pass the
`corsMiddleware` as second argument of `createApplicationBuilder` (see [With a router](#with-a-router)) and call
`app(serverRequest)` instead of `corsMiddleware(serverRequest, trpcHandler)`.

```ts
import { createServer } from 'node:http';
import { createServerRequestFactory, createUriFactory } from '@chubbyts/chubbyts-http/message-factory';
import { createServerRequestHelpers } from '@chubbyts/chubbyts-http/message-helper';
import { createCorsMiddleware } from '@chubbyts/chubbyts-http-cors/middleware';
import {
  createAllowOriginExact,
  createHeadersNegotiator,
  createMethodNegotiator,
  createOriginNegotiator,
} from '@chubbyts/chubbyts-http-cors/negotiation';
import {
  createNodeRequestToServerRequestFactory,
  createResponseToNodeResponseEmitter,
} from '@chubbyts/chubbyts-http-node/node';

const serverRequestHelpers = createServerRequestHelpers();

const corsMiddleware = createCorsMiddleware(
  responseFactory,
  responseHelpers,
  createOriginNegotiator(serverRequestHelpers, [createAllowOriginExact('https://app.example.com')]),
  createMethodNegotiator(serverRequestHelpers, ['GET', 'POST']),
  createHeadersNegotiator(serverRequestHelpers, ['content-type', 'trpc-accept']),
);

const nodeRequestToServerRequest = createNodeRequestToServerRequestFactory(
  createUriFactory(),
  createServerRequestFactory(),
  serverRequestHelpers,
  undefined,
  10_000, // request body timeout ms
  1024 * 1024, // request body max bytes
);

const responseToNodeResponse = createResponseToNodeResponseEmitter();

createServer(async (req, res) => {
  responseToNodeResponse(await corsMiddleware(nodeRequestToServerRequest(req, res), trpcHandler), res);
}).listen(3000);
```

## Copyright

2026 Dominik Zogg

[1]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-trpc
[2]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-types
[3]: https://www.npmjs.com/package/@trpc/server
[4]: https://www.npmjs.com/package/@chubbyts/chubbyts-http
[5]: https://trpc.io/docs/server/adapters/fetch
[6]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-node
[7]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-cors
[8]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-fetch
[9]: https://www.npmjs.com/package/@chubbyts/chubbyts-framework
[10]: https://www.npmjs.com/package/@chubbyts/chubbyts-framework-router-path-to-regexp
