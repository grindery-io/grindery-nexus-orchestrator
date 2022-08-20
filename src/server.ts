import "dotenv/config";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { LoggerAdaptToConsole, LOG_LEVEL } from "console-log-json";
import routes from "./routing";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
app.post("/", require("./index").http);
// eslint-disable-next-line @typescript-eslint/no-var-requires
app.options(/.*/, require("./index").http);

app.use("/", routes);

const port = parseInt(process.env.PORT || "", 10) || 3000;

if (process.env.LOG_JSON) {
  LoggerAdaptToConsole({ logLevel: LOG_LEVEL.debug });
}

console.log(`Listening on http://0.0.0.0:${port}`);
app.listen(port);
