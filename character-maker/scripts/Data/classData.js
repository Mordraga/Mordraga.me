// --- Classes ---
export const classes = [
  "Cleric","Paladin","Druid","Inquisitor","Tech-Priest","Battle Sister",
  "Psyker","Sorcerer","Barbarian","Fighter","Rogue","Ranger",
  "Monk","Bard","Assassin","Stormtrooper"
];

export function isReligiousClass(charClass) {
  const religiousKeywords = ["Cleric","Paladin","Druid","Inquisitor","Tech-Priest","Battle Sister","Psyker"];
  return religiousKeywords.some(keyword => charClass.includes(keyword));
}
