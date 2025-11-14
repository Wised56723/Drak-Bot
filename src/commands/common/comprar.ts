import { 
    ApplicationCommandType, 
    ApplicationCommandOptionType,
    EmbedBuilder,
    TextChannel
} from "discord.js";
import { Command } from "../../structs/types/Command";
import db = require("../../database.js");
import { RunResult } from "sqlite3";
import { config } from "../..";

// Define a interface para o objeto Rifa (mínimo)
interface Rifa {
    id_rifa: number;
    total_bilhetes: number;
    status: string;
    preco_bilhete: number;
    nome_premio: string;
}

// Define a interface para o Usuário
interface Usuario {
    id_discord: string;
    nome: string;
}

// Função para contar bilhetes (vendidos + pendentes)
function countBilhetesReservados(rifaId: number): Promise<number> {
     return new Promise((resolve, reject) => {
        const sql = `
            SELECT SUM(c.quantidade) as reservados 
            FROM Compras c
            WHERE c.id_rifa_fk = ? AND (c.status = 'aprovada' OR c.status = 'em_analise')
        `;
        
        db.get(sql, [rifaId], (err: Error, row: { reservados: number }) => {
            if (err) return reject(err);
            resolve(row?.reservados || 0);
        });
    });
}

export default new Command({
    name: "comprar",
    description: "Compra bilhetes para uma rifa.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: true,

    options: [
        {
            name: "rifa",
            description: "O ID (número) da rifa que você quer comprar.",
            type: ApplicationCommandOptionType.Integer,
            required: true
        },
        {
            name: "quantidade",
            description: "Quantos bilhetes você quer comprar.",
            type: ApplicationCommandOptionType.Integer,
            required: true
        }
    ],

    async run({ client, interaction, options }) {

        if (interaction.guild) {
            return interaction.reply({
                content: "Este comando só pode ser usado na minha conversa privada (DM).",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });
        
        const id_discord = interaction.user.id;
        const id_rifa = options.getInteger("rifa", true);
        const quantidade = options.getInteger("quantidade", true);

        if (quantidade <= 0) {
            return interaction.editReply("A quantidade deve ser pelo menos 1.");
        }

        try {
            const usuario: Usuario = await new Promise((resolve, reject) => {
                db.get("SELECT * FROM Usuarios WHERE id_discord = ?", 
                    [id_discord], 
                    (err, row: Usuario) => err ? reject(err) : resolve(row)
                );
            });

            if (!usuario) {
                return interaction.editReply("Você não está cadastrado! Use `/cadastro` primeiro antes de comprar.");
            }

            const rifa: Rifa = await new Promise((resolve, reject) => {
                db.get("SELECT * FROM Rifas WHERE id_rifa = ?", 
                    [id_rifa], 
                    (err, row: Rifa) => err ? reject(err) : resolve(row)
                );
            });

            if (!rifa) {
                return interaction.editReply(`A rifa com ID #${id_rifa} não foi encontrada.`);
            }

            // --- LÓGICA DE STATUS MODIFICADA ---
            // Permite comprar se estiver 'ativa' OU 'aguardando_sorteio'
            if (rifa.status !== 'ativa' && rifa.status !== 'aguardando_sorteio') {
                return interaction.editReply(`A rifa "${rifa.nome_premio}" não está aceitando compras no momento (Status: ${rifa.status}).`);
            }
            // --- FIM DA MODIFICAÇÃO ---

            const reservados = await countBilhetesReservados(id_rifa);
            const disponiveis = rifa.total_bilhetes - reservados;

            if (quantidade > disponiveis) {
                return interaction.editReply(
                    `Infelizmente não há bilhetes suficientes. \n` +
                    `Você tentou comprar: **${quantidade}**\n` +
                    `Disponíveis: **${disponiveis}**`
                );
            }

            const data_compra = new Date().toISOString();
            const sql = `INSERT INTO Compras (id_rifa_fk, id_usuario_fk, data_compra, quantidade, status) 
                         VALUES (?, ?, ?, ?, 'em_analise')`;
            const params = [id_rifa, id_discord, data_compra, quantidade];
            
            const newCompraId = await new Promise<number>((resolve, reject) => {
                db.run(sql, params, function(this: RunResult, err: Error | null) {
                    if (err) return reject(err);
                    resolve(this.lastID);
                });
            });

            const totalPreco = (quantidade * rifa.preco_bilhete)
                .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            const replyEmbed = new EmbedBuilder()
                .setTitle("✅ Reserva de Bilhetes Realizada!")
                .setDescription(
                    `Sua reserva para a rifa **${rifa.nome_premio}** foi registrada com sucesso.\n` +
                    `**ID da sua Compra:** \`${newCompraId}\` (guarde este número!)\n\n` +
                    `Para confirmar, realize o pagamento e aguarde a aprovação de um administrador.`
                )
                .addFields(
                    { name: "Bilhetes Reservados", value: `${quantidade}`, inline: true },
                    { name: "Valor Total", value: `**${totalPreco}**`, inline: true },
                    { name: "Instruções de Pagamento", value: `\`\`\`${config.pixKey}\`\`\`` }
                )
                .setColor("Blue")
                .setFooter({ text: "Após o pagamento, um admin irá aprovar sua compra." });
            
            await interaction.editReply({ embeds: [replyEmbed] });

            try {
                const logChannel = await client.channels.fetch(config.logChannelId) as TextChannel;
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("🔔 Nova Compra Pendente")
                        .setDescription(`Um novo pedido de compra foi feito e aguarda aprovação.`)
                        .addFields(
                            { name: "ID da Compra", value: `\`${newCompraId}\``, inline: true },
                            { name: "Usuário", value: `${interaction.user.tag} (<@${id_discord}>)`, inline: false },
                            { name: "Rifa", value: `(#${id_rifa}) ${rifa.nome_premio}`, inline: false },
                            { name: "Quantidade", value: `${quantidade}`, inline: true },
                            { name: "Valor", value: totalPreco, inline: true }
                        )
                        .setColor("Orange")
                        .setTimestamp();
                    
                    await logChannel.send({ 
                        content: `Use \`/gestao aprovar id_compra: ${newCompraId}\` para aprovar.`,
                        embeds: [logEmbed] 
                    });
                }
            } catch (logErr) {
                console.error("Erro ao enviar log de compra:", logErr);
            }

        } catch (error: any) {
            console.error("Erro no comando /comprar:", error);
            await interaction.editReply("Ocorreu um erro inesperado ao processar sua compra. 😢");
        }
    },
});