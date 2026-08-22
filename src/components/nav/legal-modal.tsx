"use client";

import { useEffect, useRef } from "react";

interface LegalModalProps {
  page: "privacy" | "terms" | "sources";
  onClose: () => void;
}

export function LegalModal({ page, onClose }: LegalModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const title = page === "privacy" ? "Privacy Policy" : page === "terms" ? "Terms of Service" : "Data Sources";

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>

        <div className="prose prose-sm max-w-none text-gray-600 dark:prose-invert dark:text-gray-300 [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-gray-800 [&_h3]:dark:text-gray-200 [&_p]:mb-2 [&_p]:text-[13px] [&_p]:leading-relaxed [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:text-[13px] [&_li]:mb-1">
          {page === "privacy" && <PrivacyContent />}
          {page === "terms" && <TermsContent />}
          {page === "sources" && <SourcesContent />}
        </div>

        <p className="mt-4 text-[11px] text-gray-400">
          Last updated: March 2026 &middot; Contact: <a href="mailto:support@pumperly.com" className="underline">support@pumperly.com</a>
        </p>
      </div>
    </div>
  );
}

function PrivacyContent() {
  return (
    <>
      <p>Pumperly (&quot;we&quot;, &quot;us&quot;) is committed to protecting your privacy. This policy explains what data we collect and how we use it.</p>

      <h3>Data we collect</h3>
      <ul>
        <li><strong>Location data</strong> &mdash; If you grant permission, your browser shares your approximate GPS coordinates so we can show nearby stations and calculate routes. This data is processed in your browser and is not stored on our servers.</li>
        <li><strong>Preferences</strong> &mdash; Your language, currency, theme, and fuel type selections are saved in your browser&apos;s local storage. They never leave your device.</li>
        <li><strong>Route queries</strong> &mdash; When you plan a route, origin/destination coordinates are sent to our server to compute the route and find nearby stations. We do not log these queries or associate them with any identity.</li>
      </ul>

      <h3>Cookies</h3>
      <p>We use a single, strictly functional cookie (<code>pumperly-locale</code>) to remember your language preference so the server can render the correct language on future visits. It contains only a two-letter language code (e.g. &quot;en&quot;), expires after one year, and is never shared with third parties.</p>

      <h3>Data we do NOT collect</h3>
      <ul>
        <li>We do not use tracking cookies, analytics cookies, or third-party cookies.</li>
        <li>We do not use any analytics services (no Google Analytics, no Meta Pixel, etc.).</li>
        <li>We do not require accounts, logins, or registration.</li>
        <li>We do not collect personal information such as names, emails, or IP addresses for tracking purposes.</li>
      </ul>

      <h3>Third-party services</h3>
      <ul>
        <li><strong>Map tiles</strong> &mdash; Served via OpenStreetMap-based tile servers. Your browser downloads tiles directly; the tile server may see your IP address per standard HTTP.</li>
        <li><strong>Geocoding</strong> &mdash; Search queries are sent to a geocoding service (Photon/Komoot) to convert place names to coordinates.</li>
      </ul>

      <h3>Data retention</h3>
      <p>We do not store any personal data on our servers. User preferences are stored locally on your device (local storage) and in a single functional cookie. Both can be cleared by clearing your browser data.</p>

      <h3>Your rights</h3>
      <p>Under GDPR and applicable law, you have the right to access, rectify, and delete your personal data. Since we do not collect personal data, there is nothing to delete. If you have concerns, contact us at support@pumperly.com.</p>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <p>By using Pumperly, you agree to these terms.</p>

      <h3>Service description</h3>
      <p>Pumperly is a free tool that displays fuel and energy prices from publicly available sources. We combine this data with routing to help you find affordable fuel along your route.</p>

      <h3>Accuracy disclaimer</h3>
      <p>Fuel prices are sourced from government databases, public APIs, and third-party aggregators. Prices may be delayed, incomplete, or inaccurate. <strong>Always verify the actual price at the station before refueling.</strong> We are not responsible for incorrect pricing information.</p>

      <h3>No warranty</h3>
      <p>Pumperly is provided &quot;as is&quot; without warranties of any kind, express or implied. We do not guarantee the availability, accuracy, completeness, or reliability of the service, route calculations, or price data.</p>

      <h3>Limitation of liability</h3>
      <p>To the maximum extent permitted by law, Pumperly and its operators shall not be liable for any direct, indirect, incidental, or consequential damages arising from your use of the service, including but not limited to losses from route decisions or fuel purchases made based on displayed prices.</p>

      <h3>Acceptable use</h3>
      <ul>
        <li>Do not use automated tools to scrape or bulk-download data from Pumperly.</li>
        <li>Do not attempt to reverse-engineer, overload, or disrupt the service.</li>
        <li>Do not redistribute Pumperly&apos;s aggregated data commercially without permission.</li>
      </ul>

      <h3>Changes</h3>
      <p>We may update these terms at any time. Continued use of the service constitutes acceptance of the updated terms.</p>
    </>
  );
}

function SourcesContent() {
  return (
    <>
      <p>Pumperly aggregates fuel price data from official government sources and public APIs. We gratefully acknowledge the following data providers:</p>

      <h3>Government open data</h3>
      <ul>
        <li><strong>Spain</strong> &mdash; Ministerio para la Transicion Ecologica (MITECO), Geoportal Gasolineras</li>
        <li><strong>France</strong> &mdash; Ministere de l&apos;Economie, data.economie.gouv.fr (Licence Ouverte v2.0)</li>
        <li><strong>Italy</strong> &mdash; Ministero delle Imprese e del Made in Italy (MIMIT), Italian Open Data License v2.0</li>
        <li><strong>Portugal</strong> &mdash; Direcao-Geral de Energia e Geologia (DGEG). Non-commercial use only.</li>
        <li><strong>Austria</strong> &mdash; E-Control GmbH, Spritpreisrechner</li>
        <li><strong>Germany</strong> &mdash; Tankerkoenig.de (CC BY 4.0), data from Markttransparenzstelle fur Kraftstoffe (MTS-K) des Bundeskartellamtes</li>
        <li><strong>United Kingdom</strong> &mdash; Competition and Markets Authority (CMA), Open Government Licence v3.0</li>
        <li><strong>Ireland</strong> &mdash; PickAPump.ie</li>
        <li><strong>Croatia</strong> &mdash; Ministarstvo zastite okolisa i energetike (MZOE)</li>
        <li><strong>Slovenia</strong> &mdash; Goriva.si, Ministry of Infrastructure</li>
        <li><strong>Denmark</strong> &mdash; FuelPrices.dk API</li>
        <li><strong>Norway</strong> &mdash; Drivstoffappen / Circle K API</li>
        <li><strong>Sweden</strong> &mdash; Drivstoffappen</li>
        <li><strong>Greece</strong> &mdash; FuelGR / Ministry of Development</li>
        <li><strong>Romania</strong> &mdash; Peco-Online.ro</li>
        <li><strong>Moldova</strong> &mdash; ANRE (Agentia Nationala pentru Reglementare in Energetica)</li>
        <li><strong>Serbia</strong> &mdash; NIS Cena Goriva</li>
        <li><strong>Finland</strong> &mdash; Polttoaine.net</li>
        <li><strong>Australia (WA)</strong> &mdash; FuelWatch, Government of Western Australia</li>
        <li><strong>Australia (NSW)</strong> &mdash; FuelCheck, NSW Government (api.onegov.nsw.gov.au)</li>
        <li><strong>Argentina</strong> &mdash; Secretaria de Energia, datos.gob.ar</li>
        <li><strong>Mexico</strong> &mdash; Comision Reguladora de Energia (CRE), datos.gob.mx</li>
      </ul>

      <h3>Third-party aggregators</h3>
      <ul>
        <li><strong>Fuelo.net</strong> &mdash; Price data for Czech Republic, Hungary, Poland, Bulgaria, Slovakia, Turkey, Bosnia, North Macedonia, Estonia, Latvia, Lithuania, Switzerland</li>
        <li><strong>ANWB</strong> &mdash; Netherlands, Belgium, Luxembourg</li>
      </ul>

      <h3>EV charging data</h3>
      <ul>
        <li><strong>Open Charge Map</strong> &mdash; EV charging station locations across all supported countries. Community-maintained, Open Data Commons Open Database License (ODbL). <a href="https://openchargemap.org" target="_blank" rel="noopener noreferrer">openchargemap.org</a></li>
        <li><strong>Mapa REVE</strong> &mdash; EV charging station locations in Spain. Source: Red El&eacute;ctrica de Espa&ntilde;a, S.A.U. Used non-commercially and reproduced without alteration. <a href="https://www.mapareve.es" target="_blank" rel="noopener noreferrer">mapareve.es</a></li>
      </ul>

      <h3>Map and routing</h3>
      <ul>
        <li><strong>OpenStreetMap</strong> &mdash; Map data &copy; OpenStreetMap contributors, ODbL license</li>
        <li><strong>Valhalla</strong> &mdash; Open-source routing engine (MIT license)</li>
        <li><strong>Photon</strong> &mdash; Geocoding powered by Komoot/OpenStreetMap</li>
      </ul>

      <p>If you are a data provider and have concerns about how your data is used, please contact us at support@pumperly.com.</p>
    </>
  );
}
