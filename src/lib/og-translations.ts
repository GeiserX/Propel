import type { Locale } from "./i18n";

interface OgStrings {
  title: string;
  description: string;
  imageSubtitle: string;
  ogLocale: string;
}

export const OG_TRANSLATIONS: Record<Locale, OgStrings> = {
  es: {
    title: "Pumperly - Planificador de Rutas Energéticas",
    description:
      "Encuentra las gasolineras y puntos de carga más baratos en tu ruta. Precios en tiempo real en 36 países.",
    imageSubtitle: "Gasolineras y carga EV más baratas en tu ruta",
    ogLocale: "es_ES",
  },
  en: {
    title: "Pumperly - Energy Route Planner",
    description:
      "Find the cheapest fuel & EV charging stations along your route. Real-time prices across 36 countries.",
    imageSubtitle: "Find the cheapest fuel & EV charging along your route",
    ogLocale: "en_US",
  },
  fr: {
    title: "Pumperly - Planificateur d'Itinéraire Énergétique",
    description:
      "Trouvez les stations-service et bornes de recharge les moins chères sur votre trajet. Prix en temps réel dans 36 pays.",
    imageSubtitle:
      "Carburant et recharge EV les moins chers sur votre trajet",
    ogLocale: "fr_FR",
  },
  de: {
    title: "Pumperly - Energie-Routenplaner",
    description:
      "Finden Sie die günstigsten Tankstellen und Ladestationen entlang Ihrer Route. Echtzeitpreise in 36 Ländern.",
    imageSubtitle: "Günstigste Tankstellen & Ladestationen auf Ihrer Route",
    ogLocale: "de_DE",
  },
  it: {
    title: "Pumperly - Pianificatore di Percorsi Energetici",
    description:
      "Trova le stazioni di rifornimento e ricarica più economiche lungo il tuo percorso. Prezzi in tempo reale in 36 paesi.",
    imageSubtitle:
      "Carburante e ricarica EV più economici sul tuo percorso",
    ogLocale: "it_IT",
  },
  pt: {
    title: "Pumperly - Planeador de Rotas Energéticas",
    description:
      "Encontre os postos de combustível e estações de carregamento mais baratos na sua rota. Preços em tempo real em 36 países.",
    imageSubtitle:
      "Combustível e carregamento EV mais baratos na sua rota",
    ogLocale: "pt_PT",
  },
  pl: {
    title: "Pumperly - Planer Tras Paliwowych",
    description:
      "Znajdź najtańsze stacje paliw i ładowania na swojej trasie. Ceny w czasie rzeczywistym w 36 krajach.",
    imageSubtitle: "Najtańsze paliwo i ładowanie EV na Twojej trasie",
    ogLocale: "pl_PL",
  },
  cs: {
    title: "Pumperly - Plánovač Energetických Tras",
    description:
      "Najděte nejlevnější čerpací stanice a nabíjecí body na vaší trase. Ceny v reálném čase ve 36 zemích.",
    imageSubtitle: "Nejlevnější palivo a nabíjení EV na vaší trase",
    ogLocale: "cs_CZ",
  },
  hu: {
    title: "Pumperly - Energetikai Útvonaltervező",
    description:
      "Találja meg a legolcsóbb töltőállomásokat útvonala mentén. Valós idejű árak 36 országban.",
    imageSubtitle: "Legolcsóbb üzemanyag és EV töltés az útvonalán",
    ogLocale: "hu_HU",
  },
  bg: {
    title: "Pumperly - Планиране на Енергийни Маршрути",
    description:
      "Намерете най-евтините бензиностанции и зарядни станции по маршрута си. Цени в реално време в 36 държави.",
    imageSubtitle: "Най-евтино гориво и EV зареждане по маршрута ви",
    ogLocale: "bg_BG",
  },
  sk: {
    title: "Pumperly - Plánovač Energetických Trás",
    description:
      "Nájdite najlacnejšie čerpacie stanice a nabíjacie body na vašej trase. Ceny v reálnom čase v 36 krajinách.",
    imageSubtitle: "Najlacnejšie palivo a nabíjanie EV na vašej trase",
    ogLocale: "sk_SK",
  },
  da: {
    title: "Pumperly - Energiruteplanlægger",
    description:
      "Find de billigste tankstationer og ladestationer langs din rute. Realtidspriser i 36 lande.",
    imageSubtitle: "Billigste brændstof og EV-opladning langs din rute",
    ogLocale: "da_DK",
  },
  sv: {
    title: "Pumperly - Energiruttplanerare",
    description:
      "Hitta de billigaste tankstationerna och laddstationerna längs din rutt. Realtidspriser i 36 länder.",
    imageSubtitle: "Billigaste bränsle och EV-laddning längs din rutt",
    ogLocale: "sv_SE",
  },
  no: {
    title: "Pumperly - Energiruteplanlegger",
    description:
      "Finn de billigste drivstoffstasjonene og ladestasjonene langs ruten din. Sanntidspriser i 36 land.",
    imageSubtitle: "Billigste drivstoff og EV-lading langs ruten din",
    ogLocale: "nb_NO",
  },
  sr: {
    title: "Pumperly - Planer Energetskih Ruta",
    description:
      "Pronađite najjeftinije benzinske i stanice za punjenje na vašoj ruti. Cene u realnom vremenu u 36 zemalja.",
    imageSubtitle: "Najjeftinije gorivo i EV punjenje na vašoj ruti",
    ogLocale: "sr_RS",
  },
  fi: {
    title: "Pumperly - Energiareittisuunnittelija",
    description:
      "Löydä edullisimmat huoltoasemat ja latausasemat reitilläsi. Reaaliaikaiset hinnat 36 maassa.",
    imageSubtitle: "Edullisimmat polttoaineet ja EV-lataus reitilläsi",
    ogLocale: "fi_FI",
  },
};

export const SUPPORTED_LOCALES = Object.keys(OG_TRANSLATIONS) as Locale[];
export const DEFAULT_LOCALE: Locale = "es";
