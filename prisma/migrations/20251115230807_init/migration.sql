-- CreateTable
CREATE TABLE "Usuario" (
    "id_discord" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Rifa" (
    "id_rifa" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome_premio" TEXT NOT NULL,
    "total_bilhetes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ativa',
    "metodo_sorteio" TEXT NOT NULL,
    "meta_completude" REAL,
    "channel_id" TEXT,
    "message_id" TEXT,
    "preco_bilhete" REAL NOT NULL,
    "sorteio_data" DATETIME,
    "top_compradores_count" INTEGER NOT NULL DEFAULT 0,
    "top_compradores_premios" TEXT
);

-- CreateTable
CREATE TABLE "Compras" (
    "id_compra" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id_rifa_fk" INTEGER NOT NULL,
    "id_usuario_fk" TEXT NOT NULL,
    "data_compra" DATETIME NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_analise',
    CONSTRAINT "Compras_id_rifa_fk_fkey" FOREIGN KEY ("id_rifa_fk") REFERENCES "Rifa" ("id_rifa") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Compras_id_usuario_fk_fkey" FOREIGN KEY ("id_usuario_fk") REFERENCES "Usuario" ("id_discord") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bilhetes" (
    "id_bilhete" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id_compra_fk" INTEGER NOT NULL,
    "numero_bilhete" TEXT NOT NULL,
    CONSTRAINT "Bilhetes_id_compra_fk_fkey" FOREIGN KEY ("id_compra_fk") REFERENCES "Compras" ("id_compra") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PremiosInstantaneos" (
    "id_premio" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id_rifa_fk" INTEGER NOT NULL,
    "numero_bilhete" TEXT NOT NULL,
    "descricao_premio" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "id_usuario_vencedor_fk" TEXT,
    CONSTRAINT "PremiosInstantaneos_id_rifa_fk_fkey" FOREIGN KEY ("id_rifa_fk") REFERENCES "Rifa" ("id_rifa") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PremiosInstantaneos_id_usuario_vencedor_fk_fkey" FOREIGN KEY ("id_usuario_vencedor_fk") REFERENCES "Usuario" ("id_discord") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
