import axios from "axios";
import { JSONRPCClient } from "json-rpc-2.0";

const credentialManagerClient: JSONRPCClient<{ token: string }> = new JSONRPCClient((jsonRPCRequest, params) =>
  axios
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    .post(process.env.CREDENTIAL_MANAGER_URI!, jsonRPCRequest, {
      headers: params?.token ? { Authorization: `Bearer ${params?.token}` } : {},
    })
    .then(
      (response) => credentialManagerClient.receive(response.data),
      (e) => {
        if (e.response?.data?.id === jsonRPCRequest.id) {
          credentialManagerClient.receive(e.response.data);
          return;
        }
        console.error("Unexpected error from JSON-RPC request: ", e, { jsonRPCRequest });
        if (jsonRPCRequest.id) {
          credentialManagerClient.receive({
            jsonrpc: jsonRPCRequest.jsonrpc,
            id: jsonRPCRequest.id,
            error: e.toString(),
          });
        }
      }
    )
);
export const callCredentialManager = (method: string, params, token?: string) =>
  credentialManagerClient.timeout(5000).request(method, params, token ? { token } : undefined);
