/*
  Warnings:

  - A unique constraint covering the columns `[referral_code]` on the table `Usuario` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN "referral_code" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bilhetes" (
    "id_bilhete" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id_compra_fk" INTEGER NOT NULL,
    "numero_bilhete" TEXT NOT NULL,
    "is_free" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Bilhetes_id_compra_fk_fkey" FOREIGN KEY ("id_compra_fk") REFERENCES "Compras" ("id_compra") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Bilhetes" ("id_bilhete", "id_compra_fk", "numero_bilhete") SELECT "id_bilhete", "id_compra_fk", "numero_bilhete" FROM "Bilhetes";
DROP TABLE "Bilhetes";
ALTER TABLE "new_Bilhetes" RENAME TO "Bilhetes";
CREATE TABLE "new_Compras" (
    "id_compra" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id_rifa_fk" INTEGER NOT NULL,
    "id_usuario_fk" TEXT NOT NULL,
    "data_compra" DATETIME NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_analise',
    "id_indicador_fk" TEXT,
    CONSTRAINT "Compras_id_rifa_fk_fkey" FOREIGN KEY ("id_rifa_fk") REFERENCES "Rifa" ("id_rifa") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Compras_id_usuario_fk_fkey" FOREIGN KEY ("id_usuario_fk") REFERENCES "Usuario" ("id_discord") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Compras_id_indicador_fk_fkey" FOREIGN KEY ("id_indicador_fk") REFERENCES "Usuario" ("id_discord") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Compras" ("data_compra", "id_compra", "id_rifa_fk", "id_usuario_fk", "quantidade", "status") SELECT "data_compra", "id_compra", "id_rifa_fk", "id_usuario_fk", "quantidade", "status" FROM "Compras";
DROP TABLE "Compras";
ALTER TABLE "new_Compras" RENAME TO "Compras";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_referral_code_key" ON "Usuario"("referral_code");
