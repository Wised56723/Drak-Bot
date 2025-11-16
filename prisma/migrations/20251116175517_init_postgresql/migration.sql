-- CreateTable
CREATE TABLE "Usuario" (
    "id_discord" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "referral_code" TEXT,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id_discord")
);

-- CreateTable
CREATE TABLE "Rifa" (
    "id_rifa" SERIAL NOT NULL,
    "nome_premio" TEXT NOT NULL,
    "total_bilhetes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ativa',
    "metodo_sorteio" TEXT NOT NULL,
    "meta_completude" DOUBLE PRECISION,
    "channel_id" TEXT,
    "message_id" TEXT,
    "preco_bilhete" DOUBLE PRECISION NOT NULL,
    "sorteio_data" TIMESTAMP(3),
    "top_compradores_count" INTEGER NOT NULL DEFAULT 0,
    "top_compradores_premios" TEXT,

    CONSTRAINT "Rifa_pkey" PRIMARY KEY ("id_rifa")
);

-- CreateTable
CREATE TABLE "Compras" (
    "id_compra" SERIAL NOT NULL,
    "id_rifa_fk" INTEGER NOT NULL,
    "id_usuario_fk" TEXT NOT NULL,
    "data_compra" TIMESTAMP(3) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_analise',
    "id_indicador_fk" TEXT,

    CONSTRAINT "Compras_pkey" PRIMARY KEY ("id_compra")
);

-- CreateTable
CREATE TABLE "Bilhetes" (
    "id_bilhete" SERIAL NOT NULL,
    "id_compra_fk" INTEGER NOT NULL,
    "numero_bilhete" TEXT NOT NULL,
    "is_free" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Bilhetes_pkey" PRIMARY KEY ("id_bilhete")
);

-- CreateTable
CREATE TABLE "PremiosInstantaneos" (
    "id_premio" SERIAL NOT NULL,
    "id_rifa_fk" INTEGER NOT NULL,
    "numero_bilhete" TEXT NOT NULL,
    "descricao_premio" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "id_usuario_vencedor_fk" TEXT,

    CONSTRAINT "PremiosInstantaneos_pkey" PRIMARY KEY ("id_premio")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_referral_code_key" ON "Usuario"("referral_code");

-- AddForeignKey
ALTER TABLE "Compras" ADD CONSTRAINT "Compras_id_rifa_fk_fkey" FOREIGN KEY ("id_rifa_fk") REFERENCES "Rifa"("id_rifa") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compras" ADD CONSTRAINT "Compras_id_usuario_fk_fkey" FOREIGN KEY ("id_usuario_fk") REFERENCES "Usuario"("id_discord") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compras" ADD CONSTRAINT "Compras_id_indicador_fk_fkey" FOREIGN KEY ("id_indicador_fk") REFERENCES "Usuario"("id_discord") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bilhetes" ADD CONSTRAINT "Bilhetes_id_compra_fk_fkey" FOREIGN KEY ("id_compra_fk") REFERENCES "Compras"("id_compra") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiosInstantaneos" ADD CONSTRAINT "PremiosInstantaneos_id_rifa_fk_fkey" FOREIGN KEY ("id_rifa_fk") REFERENCES "Rifa"("id_rifa") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiosInstantaneos" ADD CONSTRAINT "PremiosInstantaneos_id_usuario_vencedor_fk_fkey" FOREIGN KEY ("id_usuario_vencedor_fk") REFERENCES "Usuario"("id_discord") ON DELETE SET NULL ON UPDATE CASCADE;
