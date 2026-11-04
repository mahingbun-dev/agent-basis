const VENDOR_TOOL_SERVICE_ID = "@event/vendor-registry";
function createVendorRegistry() {
  const quotes = [];
  return {
    id: VENDOR_TOOL_SERVICE_ID,
    recordQuote(quote) {
      quotes.push(quote);
      return this;
    },
    neutralTable() {
      return quotes.map((quote) => ({
        vendor: quote.vendor,
        comparableTotalCny: quote.totalCny + (quote.includesAv ? 0 : quote.avExtraCny ?? 0),
        source: quote.source
      })).sort((a, b) => a.comparableTotalCny - b.comparableTotalCny || a.vendor.localeCompare(b.vendor));
    },
    quotesOf(vendor) {
      return quotes.filter((quote) => quote.vendor === vendor);
    }
  };
}
const VENUE_CATALOG = [
  { name: "\u5F00\u5143\u5385", district: "\u5E02\u4E2D\u5FC3", metro: "\u5730\u94C12\u53F7\u7EBF \u5F00\u5143\u7AD9", capacity: 520, quoteCny: 88e3, includesAv: true, source: "\u5F00\u5143\u9152\u5E97 2026 \u62A5\u4EF7\u5355 #A-1041" },
  { name: "\u6D32\u9645\u5385", district: "\u5E02\u4E2D\u5FC3", metro: "\u5730\u94C11\u53F7\u7EBF \u6D32\u9645\u7AD9", capacity: 480, quoteCny: 102e3, includesAv: false, avExtraCny: 12e3, source: "\u6D32\u9645\u9152\u5E97 2026 \u62A5\u4EF7\u5355 #B-2210" },
  { name: "\u4E07\u8C6A\u5385", district: "\u9AD8\u65B0\u533A", metro: "\u5730\u94C13\u53F7\u7EBF \u4E07\u8C6A\u7AD9", capacity: 500, quoteCny: 95e3, includesAv: true, source: "\u4E07\u8C6A\u9152\u5E97 2026 \u62A5\u4EF7\u5355 #C-0778" },
  { name: "\u6EE8\u6C5F\u5BB4\u4F1A\u5385", district: "\u6C5F\u7554", metro: "\u5730\u94C14\u53F7\u7EBF \u6EE8\u6C5F\u7AD9", capacity: 300, quoteCny: 62e3, includesAv: true, source: "\u6EE8\u6C5F\u4F1A\u5C55 2026 \u62A5\u4EF7\u5355 #D-0132" },
  { name: "\u4E91\u9876\u4F1A\u8BAE\u4E2D\u5FC3", district: "\u9AD8\u65B0\u533A", capacity: 800, quoteCny: 158e3, includesAv: false, avExtraCny: 18e3, source: "\u4E91\u9876\u4F1A\u5C55 2026 \u62A5\u4EF7\u5355 #E-5501" },
  { name: "\u8001\u57CE\u4F1A\u5802", district: "\u8001\u57CE\u533A", capacity: 260, quoteCny: 38e3, includesAv: false, avExtraCny: 6e3, source: "\u8001\u57CE\u4F1A\u5802 2026 \u62A5\u4EF7\u5355 #F-0093" }
];
function comparableVenueTotal(venue) {
  return venue.quoteCny + (venue.includesAv ? 0 : venue.avExtraCny ?? 0);
}
function searchVenueCatalog(filters, catalog = VENUE_CATALOG) {
  const keyword = filters.keyword?.trim() ?? "";
  return catalog.filter((venue) => {
    if (filters.capacityMin !== void 0 && venue.capacity < filters.capacityMin) return false;
    if (filters.district !== void 0 && !venue.district.includes(filters.district)) return false;
    if (keyword.length > 0 && !(venue.name.includes(keyword) || venue.district.includes(keyword))) return false;
    return true;
  }).map((venue) => ({ venue, comparableTotalCny: comparableVenueTotal(venue) })).sort((a, b) => a.venue.capacity - b.venue.capacity || a.comparableTotalCny - b.comparableTotalCny || a.venue.name.localeCompare(b.venue.name));
}
export {
  VENDOR_TOOL_SERVICE_ID,
  VENUE_CATALOG,
  comparableVenueTotal,
  createVendorRegistry,
  searchVenueCatalog
};
