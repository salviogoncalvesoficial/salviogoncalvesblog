import type { Site, SocialObjects } from "./types";
export const SITE: Site = {
  website: "https://salviogoncalves.com.br",
  author: "Salvio Gonçalves",
  desc: "Salvio Gonçalves, terapeuta. Reflexões sobre ansiedade, procrastinação, autoconhecimento e saúde emocional. Um espaço de acolhimento para uma vida mais leve.",
  title: "Salvio Gonçalves",
  ogImage: "1789059341135-og-image-salvio.png",
  lightAndDarkMode: true,
  postPerPage: 12,
  scheduledPostMargin: 15 * 60 * 1000,
};
export const LOCALE = { lang: "pt-br", langTag: ["pt-BR"] } as const;
export const LOGO_IMAGE = { enable: true, svg: false, width: 300, height: 105 };
export const SOCIALS: SocialObjects = [
  { name: "Instagram", href: "https://instagram.com/salviogoncalvesoficial", linkTitle: "Salvio Gonçalves no Instagram", active: true },
  { name: "Mail", href: "mailto:contato@salviogoncalves.com.br", linkTitle: "Enviar e-mail para Salvio Gonçalves", active: true },
];
// Blog pronto para receber os novos artigos do projeto.
