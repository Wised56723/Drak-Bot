import { 
    ApplicationCommandType, 
    EmbedBuilder
} from "discord.js";
import { Command } from "../../structs/types/Command";
// NOVO: Importa o Prisma
import { prisma } from "../../prismaClient";

export default new Command({
    name: "meus-bilhetes",
    description: "Mostra todos os seus bilhetes e compras de rifas.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: true,

    async run({ client, interaction, options }) {

        // 1. Verificação de DM (Sem mudança)
        if (interaction.guild) {
            return interaction.reply({
                content: "Este comando só pode ser usado na minha conversa privada (DM).",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: false });
        
        const id_discord = interaction.user.id;

        try {
            // 2. VERIFICAR SE O USUÁRIO ESTÁ CADASTRADO
            const usuario = await prisma.usuario.findUnique({
                where: { id_discord: id_discord }
            });

            if (!usuario) {
                return interaction.editReply("Você não está cadastrado! Use `/cadastro` primeiro.");
            }

            // 3. BUSCAR TODAS AS COMPRAS E BILHETES DO USUÁRIO
            // O Prisma torna isto muito mais fácil!
            const compras = await prisma.compras.findMany({
                where: { id_usuario_fk: id_discord },
                // 'include' é como um JOIN. Pedimos para incluir
                // os dados da Rifa e os Bilhetes associados.
                include: {
                    rifa: true,     // Traz os dados da Rifa
                    bilhetes: true  // Traz a lista de Bilhetes
                },
                orderBy: [
                    { rifa: { id_rifa: 'desc' } },
                    { data_compra: 'desc' }
                ]
            });

            if (compras.length === 0) {
                return interaction.editReply("Você ainda não fez nenhuma compra de rifa.");
            }

            // 4. MONTAR O EMBED
            const embed = new EmbedBuilder()
                .setTitle(`Minhas Compras e Bilhetes`)
                .setColor("Blue")
                .setDescription("Aqui está um resumo de todas as suas atividades de rifa.");

            // Agrupa as compras por Rifa para organizar o Embed
            // (Esta parte da lógica não muda)
            const rifasAgrupadas: Record<number, typeof compras> = {};
            for (const compra of compras) {
                if (!rifasAgrupadas[compra.id_rifa_fk]) {
                    rifasAgrupadas[compra.id_rifa_fk] = [];
                }
                rifasAgrupadas[compra.id_rifa_fk].push(compra);
            }

            // Adiciona um campo para cada Rifa
            for (const rifaId in rifasAgrupadas) {
                const comprasDaRifa = rifasAgrupadas[rifaId];
                const nomePremio = comprasDaRifa[0].rifa.nome_premio; // Acesso via Prisma
                
                let campoValor = "";

                for (const compra of comprasDaRifa) {
                    const data = new Date(compra.data_compra).toLocaleDateString('pt-BR');
                    
                    if (compra.status === 'aprovada') {
                        // Acesso via Prisma
                        const numeros = compra.bilhetes.map(b => b.numero_bilhete).join(', ');
                        campoValor += `✅ **Aprovada** (ID: \`${compra.id_compra}\`) - ${compra.quantidade} bilhete(s)\n`;
                        campoValor += `> \`\`\`${numeros || 'Nenhum bilhete encontrado'}\`\`\`\n`;
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
            console.error("Erro no comando /meus-bilhetes (Prisma):", error);
            await interaction.editReply("Ocorreu um erro inesperado ao buscar suas compras. 😢");
        }
    },
});