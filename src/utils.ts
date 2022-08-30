export function getWorkflowEnvironment(workflowKey: string) {
  if (workflowKey.startsWith("staging-")) {
    return "staging";
  }
  return "production";
}

// vim: sw=2:ts=2:expandtab:fdm=syntax
