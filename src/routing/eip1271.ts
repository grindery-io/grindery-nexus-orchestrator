import { runSingleAction } from "../runtimeWorkflow";

export async function validateEip1271Signature({
  messageHash,
  signature,
  chainId,
  signer,
  environment,
}: {
  messageHash: string;
  signature: string;
  chainId: string;
  signer: string;
  environment: string;
}): Promise<boolean> {
  const input = {
    _grinderyChain: "eip155:" + chainId,
    _grinderyContractAddress: signer,
    hash: messageHash,
    signature,
  };
  try {
    const resp = (await runSingleAction({
      step: {
        type: "action",
        connector: "eip1271",
        operation: "isValidSignature",
      },
      input,
      dryRun: false,
      environment: environment || "production",
      user: { sub: "grindery-internal:orchestrator" },
    })) as { returnValue?: string };
    if (typeof resp?.returnValue !== "string" || !resp.returnValue.startsWith("0x")) {
      console.error(`validateEip1271Signature: Unexpected result: ${JSON.stringify(resp)}`);
    }
    return resp?.returnValue?.toLowerCase() === "0x1626ba7e"; // bytes4(keccak256("isValidSignature(bytes32,bytes)")
  } catch (e) {
    return false;
  }
}
