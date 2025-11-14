import { EmbedBuilder, TextChannel } from "discord.js";
import { ExtendedClient } from "../structs/ExtendedClient";
import db = require("../database.js");
import { Rifa, countBilhetesVendidos, getAllParticipants, updateRaffleMessage } from "../utils/RaffleEmbed";

// 24 horas em milissegundos
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; 
// const CHECK_INTERVAL = 60 * 1000; // 1 minuto (para testes)

/**
 * Calcula a data do próximo sorteio (Quarta ou Sábado)
 */
function calculateNextDrawDate(): Date {
    const now = new Date();
    // Ajusta para o fuso horário de Brasília (UTC-3)
    now.setHours(now.getHours() - 3);

    const dayOfWeek = now.getDay(); // 0=Domingo, 3=Quarta, 6=Sábado
    
    let daysToAdd = 0;
    
    if (dayOfWeek < 3) { // Dom, Seg, Ter
        daysToAdd = 3 - dayOfWeek; // Próxima Quarta
    } else if (dayOfWeek < 6) { // Qua, Qui, Sex
        daysToAdd = 6 - dayOfWeek; // Próximo Sábado
    } else { // Sábado
        daysToAdd = 4; // Próxima Quarta (Sábado + 4 dias)
    }

    const drawDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToAdd);
    return drawDate;
}

/**
 * Processa uma rifa que atingiu a meta
 */
async function processRifaMetaHit(client: ExtendedClient, rifa: Rifa) {
    try {
        console.log(`[LOTERIA]: Rifa #${rifa.id_rifa} atingiu a meta. Processando...`);

        const drawDate = calculateNextDrawDate();
        const drawDateISO = drawDate.toISOString();
        const drawDateString = drawDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        // 1. Atualiza o DB
        await new Promise<void>((resolve, reject) => {
            db.run("UPDATE Rifas SET status = 'aguardando_sorteio', sorteio_data = ? WHERE id_rifa = ?", 
                [drawDateISO, rifa.id_rifa], 
                (err) => err ? reject(err) : resolve()
            );
        });

        // 2. Atualiza a Mensagem Pública (agora usará o novo Embed)
        await updateRaffleMessage(client, rifa.id_rifa);

        // 3. Notificar todos os participantes
        const participants = await getAllParticipants(rifa.id_rifa);
        const dmEmbed = new EmbedBuilder()
            .setTitle(`🗓️ Sorteio Agendado! (Rifa #${rifa.id_rifa})`)
            .setDescription(`A rifa **${rifa.nome_premio}** atingiu a meta de vendas!`)
            .addFields({
                name: "Data do Sorteio",
                value: `O sorteio ocorrerá pela Loteria Federal no dia **${drawDateString}**.`,
            })
            .setColor("Blue")
            .setFooter({ text: "As vendas continuam. Boa sorte!" });

        for (const userId of participants) {
            try {
                const user = await client.users.fetch(userId);
                await user.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.error(`Erro ao enviar DM (Loteria) para ${userId}:`, dmError);
            }
        }
        console.log(`[LOTERIA]: Rifa #${rifa.id_rifa} processada. Sorteio em ${drawDateString}.`);

    } catch (error) {
        console.error(`[ERRO LOTERIA]: Falha ao processar rifa #${rifa.id_rifa}:`, error);
    }
}

/**
 * Verifica todas as rifas 'ativas' do tipo 'loteria'
 */
async function checkLotteryRifas(client: ExtendedClient) {
    console.log("[LOTERIA]: Verificando rifas 'loteria' ativas...");
    try {
        const rifas: Rifa[] = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM Rifas WHERE metodo_sorteio = 'loteria' AND status = 'ativa'", 
                [], 
                (err, rows: Rifa[]) => err ? reject(err) : resolve(rows)
            );
        });

        if (rifas.length === 0) {
            console.log("[LOTERIA]: Nenhuma rifa 'loteria' ativa encontrada.");
            return;
        }

        for (const rifa of rifas) {
            const vendidos = await countBilhetesVendidos(rifa.id_rifa);
            const meta_necessaria = rifa.total_bilhetes * (rifa.meta_completude || 1.0);

            if (vendidos >= meta_necessaria) {
                await processRifaMetaHit(client, rifa);
            }
        }
    } catch (error) {
        console.error("[ERRO LOTERIA]: Falha no loop de verificação:", error);
    }
}

/**
 * Inicia o serviço de verificação da loteria
 */
export function startLotteryScheduler(client: ExtendedClient) {
    console.log("[LOTERIA]: Serviço de Sorteio da Loteria iniciado.");
    // Roda a verificação imediatamente ao iniciar
    checkLotteryRifas(client); 
    // E depois, a cada 24 horas
    setInterval(() => checkLotteryRifas(client), CHECK_INTERVAL);
}