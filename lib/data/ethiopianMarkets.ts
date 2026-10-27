/**
 * Ethiopian market-centre catalogue: 65 towns and market places across
 * 11 administrative regions, with the zone (admin2) each sits in.
 *
 * Coordinates and region/zone names are taken verbatim from WFP's "Ethiopia - Markets"
 * reference table (via HDX, CC BY-IGO), NOT invented:
 *   https://data.humdata.org/dataset/wfp-food-prices-for-ethiopia
 *
 * The publisher still uses the pre-2020 SNNPR grouping; newer regions (Sidama, South
 * Ethiopia, Central Ethiopia, South West Ethiopia) are reported inside SNNPR by that
 * source, so the UI labels the region field "as published by the source".
 */

export interface EthiopianMarketLocation {
  marketId: string;
  name: string;
  admin1: string;
  admin2: string;
  latitude: number;
  longitude: number;
}

export const ETHIOPIAN_MARKET_LOCATIONS: EthiopianMarketLocation[] = [
  { marketId: '480', name: 'Addis Ababa', admin1: 'Addis Ababa', admin2: 'AA ZONE1', latitude: 9.02, longitude: 38.75 },
  { marketId: '511', name: 'Abaala', admin1: 'Afar', admin2: 'ZONE2', latitude: 13.36, longitude: 39.76 },
  { marketId: '1831', name: 'Asayta', admin1: 'Afar', admin2: 'ZONE1', latitude: 11.56, longitude: 41.44 },
  { marketId: '3666', name: 'Awash arba', admin1: 'Afar', admin2: 'ZONE3', latitude: 9.13, longitude: 40.16 },
  { marketId: '3669', name: 'Dalifagi', admin1: 'Afar', admin2: 'ZONE5', latitude: 10.62, longitude: 40.31 },
  { marketId: '3647', name: 'Gubiya/yalo', admin1: 'Afar', admin2: 'ZONE4', latitude: 12.37, longitude: 39.88 },
  { marketId: '467', name: 'Abomsa', admin1: 'Amhara', admin2: 'N. SHEWA (R3)', latitude: 9.98, longitude: 39.98 },
  { marketId: '482', name: 'Baher Dar', admin1: 'Amhara', admin2: 'Administrative unit not available', latitude: 11.6, longitude: 37.38 },
  { marketId: '469', name: 'Bati', admin1: 'Amhara', admin2: 'OROMIYA', latitude: 11.18, longitude: 40.02 },
  { marketId: '503', name: 'Bure', admin1: 'Amhara', admin2: 'W. GOJAM', latitude: 10.7, longitude: 37.07 },
  { marketId: '484', name: 'Dessie', admin1: 'Amhara', admin2: 'S. WELLO', latitude: 11.13, longitude: 39.63 },
  { marketId: '492', name: 'Ebinat', admin1: 'Amhara', admin2: 'S. GONDER', latitude: 12.13, longitude: 38.05 },
  { marketId: '485', name: 'Gonder', admin1: 'Amhara', admin2: 'N. GONDER', latitude: 12.6, longitude: 37.47 },
  { marketId: '496', name: 'Mota', admin1: 'Amhara', admin2: 'E. GOJAM', latitude: 11.08, longitude: 37.87 },
  { marketId: '465', name: 'Robit', admin1: 'Amhara', admin2: 'N. WELLO', latitude: 12.02, longitude: 39.63 },
  { marketId: '497', name: 'Sekota', admin1: 'Amhara', admin2: 'W. HAMRA', latitude: 12.63, longitude: 39.03 },
  { marketId: '1832', name: 'Assosa', admin1: 'B. Gumuz', admin2: 'ASOSA', latitude: 10.07, longitude: 34.53 },
  { marketId: '3670', name: 'Cheiti', admin1: 'B. Gumuz', admin2: 'METEKEL', latitude: 11.2, longitude: 35.35 },
  { marketId: '5064', name: 'Kemashi', admin1: 'B. Gumuz', admin2: 'KAMASHI', latitude: 9.48, longitude: 35.91 },
  { marketId: '472', name: 'Diredawa', admin1: 'Dire Dawa', admin2: 'DIRE DAWA', latitude: 9.59, longitude: 41.87 },
  { marketId: '506', name: 'Gambela', admin1: 'Gambela', admin2: 'ZONE 1', latitude: 8.25, longitude: 34.58 },
  { marketId: '3651', name: 'Kowerneng/Korgang', admin1: 'Gambela', admin2: 'ZONE 3', latitude: 8.33, longitude: 33.95 },
  { marketId: '517', name: 'Meti', admin1: 'Gambela', admin2: 'GODERE', latitude: 7.23, longitude: 35.32 },
  { marketId: '3078', name: 'Punido', admin1: 'Gambela', admin2: 'ZONE 2', latitude: 7.75, longitude: 34.43 },
  { marketId: '3075', name: 'Harar', admin1: 'Harari', admin2: 'HARAR/HUNDENE', latitude: 9.31, longitude: 42.12 },
  { marketId: '481', name: 'Ambo', admin1: 'Oromia', admin2: 'WEST SHEWA', latitude: 8.98, longitude: 37.85 },
  { marketId: '491', name: 'Assela', admin1: 'Oromia', admin2: 'ARSI', latitude: 7.95, longitude: 39.13 },
  { marketId: '463', name: 'Beddenno', admin1: 'Oromia', admin2: 'E. HARERGE', latitude: 9.12, longitude: 41.62 },
  { marketId: '470', name: 'Bedessa', admin1: 'Oromia', admin2: 'W. HARERGE', latitude: 8.9, longitude: 40.78 },
  { marketId: '471', name: 'Delo', admin1: 'Oromia', admin2: 'BALE', latitude: 7.25, longitude: 40.47 },
  { marketId: '514', name: 'Derashe', admin1: 'Oromia', admin2: 'GUJI', latitude: 5.67, longitude: 39.43 },
  { marketId: '11366', name: 'Dhidhesa', admin1: 'Oromia', admin2: 'ILLUBABOR', latitude: 8.08, longitude: 36.57 },
  { marketId: '11355', name: 'Gobu Sayo', admin1: 'Oromia', admin2: 'W. WELLEGA', latitude: 8.93, longitude: 35.5 },
  { marketId: '3652', name: 'Gohatsiyon/GebreGuracha', admin1: 'Oromia', admin2: 'N. SHEWA (R4)', latitude: 10, longitude: 38.25 },
  { marketId: '486', name: 'Jimma', admin1: 'Oromia', admin2: 'JIMMA', latitude: 7.67, longitude: 36.83 },
  { marketId: '499', name: 'Nekempt', admin1: 'Oromia', admin2: 'E. WELLEGA', latitude: 9.08, longitude: 36.55 },
  { marketId: '468', name: 'Wolenchiti', admin1: 'Oromia', admin2: 'E. SHEWA', latitude: 8.67, longitude: 39.43 },
  { marketId: '500', name: 'Woliso', admin1: 'Oromia', admin2: 'S.W. SHEWA', latitude: 8.53, longitude: 37.98 },
  { marketId: '479', name: 'Yabelo', admin1: 'Oromia', admin2: 'BORENA', latitude: 4.88, longitude: 38.08 },
  { marketId: '3079', name: 'Alaba', admin1: 'SNNPR', admin2: 'ALABA SW', latitude: 7.46, longitude: 38.14 },
  { marketId: '490', name: 'Amaro', admin1: 'SNNPR', admin2: 'AMARO SW', latitude: 5.83, longitude: 37.9 },
  { marketId: '513', name: 'Aroresa', admin1: 'SNNPR', admin2: 'SIDAMA', latitude: 6.22, longitude: 39.02 },
  { marketId: '3664', name: 'Dalocha', admin1: 'SNNPR', admin2: 'SELTI', latitude: 7.79, longitude: 38.25 },
  { marketId: '4108', name: 'Enseno', admin1: 'SNNPR', admin2: 'GURAGE', latitude: 8.07, longitude: 38.47 },
  { marketId: '473', name: 'Gamo Gofa', admin1: 'SNNPR', admin2: 'GAMO GOFA', latitude: 6.62, longitude: 37.15 },
  { marketId: '474', name: 'Hossana', admin1: 'SNNPR', admin2: 'HADIYA', latitude: 7.58, longitude: 37.88 },
  { marketId: '493', name: 'Karati', admin1: 'SNNPR', admin2: 'KONSO SW', latitude: 5.25, longitude: 37.48 },
  { marketId: '476', name: 'Sodo', admin1: 'SNNPR', admin2: 'WELAYITA', latitude: 6.85, longitude: 37.75 },
  { marketId: '498', name: 'Turmi', admin1: 'SNNPR', admin2: 'SOUTH OMO', latitude: 4.97, longitude: 36.48 },
  { marketId: '478', name: 'Wonago', admin1: 'SNNPR', admin2: 'GEDEO', latitude: 6.32, longitude: 38.27 },
  { marketId: '6521', name: 'Bilcilbuur', admin1: 'Somali', admin2: 'DEGEHABUR', latitude: 8.47, longitude: 43.25 },
  { marketId: '7782', name: 'Bokh', admin1: 'Somali', admin2: 'WARDER', latitude: 7.44, longitude: 46.65 },
  { marketId: '4630', name: 'Charati', admin1: 'Somali', admin2: 'AFDER', latitude: 5.34, longitude: 41.88 },
  { marketId: '3108', name: 'Dolo Ado', admin1: 'Somali', admin2: 'LIBEN', latitude: 4.42, longitude: 41.42 },
  { marketId: '7787', name: 'Duhun', admin1: 'Somali', admin2: 'FIK', latitude: 7.22, longitude: 42.7 },
  { marketId: '460', name: 'Gode', admin1: 'Somali', admin2: 'GODE', latitude: 6.02, longitude: 43.13 },
  { marketId: '461', name: 'Jijiga', admin1: 'Somali', admin2: 'JIJIGA', latitude: 9.33, longitude: 42.82 },
  { marketId: '3662', name: 'Kebri Dehar', admin1: 'Somali', admin2: 'KORAHE', latitude: 6.74, longitude: 44.28 },
  { marketId: '7810', name: 'Shinile', admin1: 'Somali', admin2: 'SHINILE', latitude: 9.69, longitude: 41.85 },
  { marketId: '466', name: 'Abi Adi', admin1: 'Tigray', admin2: 'C. TIGRAY', latitude: 13.56, longitude: 38.97 },
  { marketId: '508', name: 'Adigrat', admin1: 'Tigray', admin2: 'E. TIGRAY', latitude: 14.27, longitude: 39.46 },
  { marketId: '458', name: 'Alamata', admin1: 'Tigray', admin2: 'S. TIGRAY', latitude: 12.42, longitude: 39.56 },
  { marketId: '505', name: 'Humera', admin1: 'Tigray', admin2: 'W. TIGRAY', latitude: 14.29, longitude: 36.61 },
  { marketId: '487', name: 'Mekele', admin1: 'Tigray', admin2: 'MEKELE', latitude: 13.5, longitude: 39.48 },
  { marketId: '3107', name: 'Shire', admin1: 'Tigray', admin2: 'NW. TIGRAY', latitude: 14.1, longitude: 38.28 },
];

/** Default country-wide anchor used when a caller gives no location at all. */
export const DEFAULT_ETHIOPIAN_LOCATION: EthiopianMarketLocation =
  ETHIOPIAN_MARKET_LOCATIONS.find((m) => m.name === 'Addis Ababa') ?? ETHIOPIAN_MARKET_LOCATIONS[0];
