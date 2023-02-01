import "dotenv/config";
import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";
import { LoggerAdaptToConsole, LOG_LEVEL } from "console-log-json";
import routes from "./routing";
import { runJsonRpcServer } from "grindery-nexus-common-utils/dist/server";
import { createServer } from "./jsonrpc";

if (process.env.SENTRY_DSN) {
  Sentry.init();
}
if (process.env.LOG_JSON) {
  LoggerAdaptToConsole({ logLevel: LOG_LEVEL.debug });
}

runJsonRpcServer(createServer(), {
  middlewares: [
    cors({ origin: true, credentials: true, maxAge: 86400 }),
    express.json({
      verify(req, res, buf) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).rawBody = buf;
      },
    }),
    express.urlencoded({
      extended: true,
      verify(req, res, buf) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).rawBody = buf;
      },
    }),
    cookieParser(),
  ],
  mutateRoutes: (app) => {
    app.use("/", routes);
  },
});
