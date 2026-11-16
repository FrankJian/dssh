import { generateRsaPair } from "./rsaKeys";
import { receiveLocalTool } from "./localToolWorker";

receiveLocalTool(generateRsaPair);
