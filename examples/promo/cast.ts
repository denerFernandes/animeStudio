/** The promo's cast: five original TV-cartoon characters, each built by the kit from a short look. */
import type { ToonDoc } from "@animestudio/core";
import { type CartoonLook, cartoonCharacter } from "@animestudio/kit";

export const LOOKS: Record<string, CartoonLook> = {
  maya: {
    name: "Maya", build: "woman", female: true, skin: "#a8704f", hair: "puffs", hairColor: "#2a1b14", top: "jacket", topColor: "#ff6b5b",
    bottom: "pants", bottomColor: "#2f3a5c", shoes: "sneakers", shoeColor: "#f4f1ea", earrings: true, nose: "button",
  },
  kai: {
    name: "Kai", build: "teen", skin: "#f2c9a6", hair: "spiky", hairColor: "#2b3a8c", top: "tee", topColor: "#ffc93c",
    bottom: "shorts", bottomColor: "#2ec4b6", shoes: "sneakers", shoeColor: "#e2584a", socks: "#ffffff", freckles: true, nose: "button",
  },
  otto: {
    name: "Otto", build: "big", heavy: 0.5, skin: "#e9b48f", hair: "receding", hairColor: "#4a3426", top: "overalls", topColor: "#4f6fa8",
    top2: "#f6efe0", bottom: "pants", bottomColor: "#4f6fa8", shoes: "dress", shoeColor: "#3b2a24", moustache: true, nose: "round", jaw: "square",
  },
  nell: {
    name: "Nell", build: "elder", female: true, skin: "#f3d2bd", hair: "bun", hairColor: "#d9d6e0", top: "cardigan", topColor: "#9b6fc4",
    bottom: "longSkirt", bottomColor: "#5d4a7a", shoes: "dress", shoeColor: "#3b2a24", glasses: true, necklace: { kind: "pearls" }, nose: "round",
  },
  pip: {
    name: "Pip", build: "child", skin: "#c98f6a", hair: "afro", hairColor: "#1e1410", top: "stripes", topColor: "#2ec4b6", top2: "#f6efe0",
    bottom: "shorts", bottomColor: "#ff6b5b", shoes: "sneakers", shoeColor: "#ffc93c", socks: "#ffffff", hat: "capBack", hatColor: "#ff6b5b", nose: "button",
  },
};

export const cast = (): Record<string, ToonDoc> =>
  Object.fromEntries(Object.entries(LOOKS).map(([id, look]) => [id, cartoonCharacter(look)]));
