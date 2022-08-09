import "dotenv/config";
import bodyParser from "body-parser";
import express from "express";

import { LoggerAdaptToConsole } from "console-log-json";

if (process.env.LOG_JSON) {
  LoggerAdaptToConsole();
}

const app = express();
app.use(bodyParser.json());

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
app.post("/", require("./index").http);
// eslint-disable-next-line @typescript-eslint/no-var-requires
app.options(/.*/, require("./index").http);

const port = parseInt(process.env.PORT || "", 10) || 3000;

console.log(`Listening on port ${port}`);
app.listen(port);
