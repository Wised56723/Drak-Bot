-- DropForeignKey
ALTER TABLE "Compras" DROP CONSTRAINT "Compras_id_rifa_fk_fkey";

-- AddForeignKey
ALTER TABLE "Compras" ADD CONSTRAINT "Compras_id_rifa_fk_fkey" FOREIGN KEY ("id_rifa_fk") REFERENCES "Rifa"("id_rifa") ON DELETE CASCADE ON UPDATE CASCADE;
