import "core-js";
import { createJsonRpcServer } from "./jsonrpc";
import { Response } from "./utils";

const server = createJsonRpcServer();

export async function main(body) {
  const result = await server.receive(body);
  if (result) {
    return result;
  } else {
    return new Response(204, "");
  }
}

// vim: sw=2:ts=2:expandtab:fdm=syntax
