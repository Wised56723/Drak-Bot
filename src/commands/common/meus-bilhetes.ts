import { 
    ApplicationCommandType, 
    EmbedBuilder
} from "discord.js";
import { Command } from "../../structs/types/Command";
import db = require("../../database.js");

// ... (interface MinhaCompra não muda) ...
interface MinhaCompra {
    id_compra: number;
    status: 'aprovada' | 'em_analise' | 'rejeitada';
    quantidade: number;
    data_compra: string;
    id_rifa: number;
    nome_premio: string;
    numeros: string | null; 
}

export default new Command({
    name: "meus-bilhetes",
    description: "Mostra todos os seus bilhetes e compras de rifas.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: true,

    async run({ client, interaction, options }) {

        if (interaction.guild) {
            return interaction.reply({
                content: "Este comando só pode ser usado na minha conversa privada (DM).",
                ephemeral: true
            });
        }

        // --- MODIFICADO ---
        // A resposta será permanente.
        await interaction.deferReply({ ephemeral: false });
        
        const id_discord = interaction.user.id;

        try {
            const usuario = await new Promise((resolve, reject) => {
                db.get("SELECT 1 FROM Usuarios WHERE id_discord = ?", 
                    [id_discord], 
                    (err, row) => err ? reject(err) : resolve(row)
                );
            });

            if (!usuario) {
                return interaction.editReply("Você não está cadastrado! Use `/cadastro` primeiro.");
            }

            const sql = `
                SELECT 
                    c.id_compra, 
                    c.status, 
                    c.quantidade, 
                    c.data_compra, 
                    r.id_rifa, 
                    r.nome_premio,
                    (SELECT GROUP_CONCAT(b.numero_bilhete, ', ') 
                     FROM Bilhetes b 
                     WHERE b.id_compra_fk = c.id_compra) as numeros
                FROM Compras c
                JOIN Rifas r ON c.id_rifa_fk = r.id_rifa
                WHERE c.id_usuario_fk = ?
                ORDER BY r.id_rifa DESC, c.data_compra DESC
            `;
            
            const compras: MinhaCompra[] = await new Promise((resolve, reject) => {
                db.all(sql, [id_discord], (err, rows: MinhaCompra[]) => err ? reject(err) : resolve(rows));
            });

            if (compras.length === 0) {
                return interaction.editReply("Você ainda não fez nenhuma compra de rifa.");
            }

            const embed = new EmbedBuilder()
                .setTitle(`Minhas Compras e Bilhetes`)
                .setColor("Blue")
                .setDescription("Aqui está um resumo de todas as suas atividades de rifa.");

            const rifasAgrupadas: Record<number, MinhaCompra[]> = {};
            for (const compra of compras) {
                if (!rifasAgrupadas[compra.id_rifa]) {
                    rifasAgrupadas[compra.id_rifa] = [];
                }
                rifasAgrupadas[compra.id_rifa].push(compra);
            }

            for (const rifaId in rifasAgrupadas) {
                const comprasDaRifa = rifasAgrupadas[rifaId];
                const nomePremio = comprasDaRifa[0].nome_premio;
                
                let campoValor = "";

                for (const compra of comprasDaRifa) {
                    const data = new Date(compra.data_compra).toLocaleDateString('pt-BR');
                    
                    if (compra.status === 'aprovada') {
                        campoValor += `✅ **Aprovada** (ID: \`${compra.id_compra}\`) - ${compra.quantidade} bilhete(s)\n`;
                        campoValor += `> \`\`\`${compra.numeros || 'Nenhum bilhete encontrado'}\`\`\`\n`;
                    } else if (compra.status === 'em_analise') {
                        campoValor += `⌛ **Em Análise** (ID: \`${compra.id_compra}\`) - ${compra.quantidade} bilhete(s)\n`;
                    } else if (compra.status === 'rejeitada') {
                        campoValor += `❌ **Rejeitada** (ID: \`${compra.id_compra}\`) - ${compra.quantidade} bilhete(s) - ${data}\n`;
                    }
                }
                
                embed.addFields({ name: `Rifa #${rifaId}: ${nomePremio}`, value: campoValor });
            }
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            console.error("Erro no comando /meus-bilhetes:", error);
            await interaction.editReply("Ocorreu um erro inesperado ao buscar suas compras. 😢");
        }
    },
});