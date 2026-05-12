import express from "express";
import { evaluate } from "./controllers/evaluationController.js";

const app = express();

app.use(express.json());

app.post("/evaluate", evaluate);

app.listen(3000, () => {
  console.log("API Gateway running on port 3000");
});