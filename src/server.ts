import "dotenv/config";
import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import { LoggerAdaptToConsole, LOG_LEVEL } from "console-log-json";
import routes from "./routing";
import { runJsonRpcServer } from "grindery-nexus-common-utils/dist/server";
import { createServer } from "./jsonrpc";


if (process.env.LOG_JSON) {
  LoggerAdaptToConsole({ logLevel: LOG_LEVEL.debug });
}

runJsonRpcServer(createServer(), {
  middlewares: [
    cors({ origin: true, credentials: true, maxAge: 86400 }),
    express.json(),
    express.urlencoded({ extended: true }),
    cookieParser(),
  ],
  mutateRoutes: (app) => {
    app.use("/", routes);
  },
});
