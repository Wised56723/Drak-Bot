import { ExtendedClient } from "./structs/ExtendedClient";
export * from "colors"; 
import config from "./config.json";
// NOVO: Importa o scheduler
import { startLotteryScheduler } from "./services/LotteryScheduler";

const client = new ExtendedClient();
client.start();
export { client, config };

client.on("ready", () => {
    console.log("Bot is online!".green);
    
    // NOVO: Inicia o serviço de verificação da Loteria
    startLotteryScheduler(client);
});