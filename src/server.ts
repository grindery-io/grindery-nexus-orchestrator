import "dotenv/config";
import bodyParser from "body-parser";
import express from "express";

const app = express();
app.use(bodyParser.json());

// eslint-disable-next-line @typescript-eslint/no-var-requires
app.post("/", require("./index").http);

const port = parseInt(process.env.PORT || "", 10) || 3000;

console.log(`Listening on port ${port}`);
app.listen(port);
