/* ============================================================
   The era list the SITE shows: mega-menu "By era" and the shop's
   era dropdown are both built from this, in this order.

   Keep in step with the Era dropdown in sanity/schemas/product.js
   (Sanity can't import from here). If a product ever carries an era
   that isn't listed, the build adds it at the end rather than
   leaving it unreachable.
   ============================================================ */
export const ERAS = [
  "Base Set Era", "Gym Era", "Neo Era", "Legendary Collection",
  "e-Reader Era", "EX Era", "Diamond & Pearl Era", "Platinum Era",
  "HeartGold & SoulSilver Era", "Call of Legends", "Black & White Era",
  "XY Era", "Sun & Moon Era", "Sword & Shield Era", "Scarlet & Violet",
  "Mega Evolution Era",
  /* Collections and lines Omar browses by, alongside the eras. */
  "30th Celebration", "Mystery Pouches", "Chinese",
  "Vault Line"
];
