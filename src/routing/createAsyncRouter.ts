import { AsyncRouter } from "express-async-router";

export function createAsyncRouter() {
  return AsyncRouter({
    sender: (req, res, value) => {
      console.warn("Returning value from async handler", { url: req.url });
      try {
        const json = JSON.stringify(value);
        return res.json(json);
      } catch (e) {
        return res.json({ message: "unknown_result" });
      }
    },
  });
}
