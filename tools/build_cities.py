"""Build data/cities.json from the city-timezones dataset.

Usage:
    python3 tools/build_cities.py [SRC] [OUT]

SRC defaults to tools/cache/cityMap.json and is downloaded if missing.
"""

import argparse
import json
import re
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'cache'
UPSTREAM = (
    'https://raw.githubusercontent.com/kevinroberts/city-timezones'
    '/master/data/cityMap.json'
)

COUNTRY_FIX = {
    'United States of America': 'United States',
    'Czech Republic': 'Czechia',
    'Korea, South': 'South Korea',
    'Korea, North': 'North Korea',
    'Russian Federation': 'Russia',
    'Macedonia': 'North Macedonia',
    'Swaziland': 'Eswatini',
    'Burma': 'Myanmar',
    'Cape Verde': 'Cabo Verde',
    'Ivory Coast': "Côte d'Ivoire",
    "Cote d'Ivoire": "Côte d'Ivoire",
    'Turkey': 'Türkiye',
    'Congo, Democratic Republic of': 'DR Congo',
    'Congo (Kinshasa)': 'DR Congo',
    'Congo, Republic of': 'Congo',
    'Vatican City': 'Vatican',
    'Holy See (Vatican City)': 'Vatican',
    'Timor-Leste': 'East Timor',
    'Netherlands Antilles': 'Curaçao',
    'Hong Kong S.A.R.': 'Hong Kong',
    'Macau S.A.R': 'Macau',
    'Macau S.A.R.': 'Macau',
}

# Transcription errors in the upstream dataset, plus diacritics worth restoring
# on names people will actually search for. Keyed by the upstream spelling.
NAME_FIX = {
    'Pizen': 'Plzeň',
    'Tlimcen': 'Tlemcen',
    'Zlin': 'Zlín',
    'Akureyi': 'Akureyri',
    'Kiev': 'Kyiv',
    'Nukualofa': "Nuku'alofa",
    'Kosice': 'Košice',
    'Gdansk': 'Gdańsk',
    'Wroclaw': 'Wrocław',
    'Lodz': 'Łódź',
    'Krakow': 'Kraków',
    'Poznan': 'Poznań',
    'Malmo': 'Malmö',
    'Goteborg': 'Göteborg',
    'Orebro': 'Örebro',
    'Tromso': 'Tromsø',
    'Aarhus': 'Aarhus',
    'Debrecen': 'Debrecen',
    'Timisoara': 'Timișoara',
    'Iasi': 'Iași',
    'Constanta': 'Constanța',
    'Brasov': 'Brașov',
    'Craiova': 'Craiova',
    'Nis': 'Niš',
    'Split': 'Split',
    'Rijeka': 'Rijeka',
    'Maribor': 'Maribor',
    'Linkoping': 'Linköping',
    'Lvov': 'Lviv',
    'Odessa': 'Odesa',
    'Dnipropetrovsk': 'Dnipro',
    'Kryvyy Rih': 'Kryvyi Rih',
    'Sevastapol': 'Sevastopol',
    'Mykolayiv': 'Mykolaiv',
    'Vinnytsya': 'Vinnytsia',
    'Zaporizhzhya': 'Zaporizhzhia',
}

# Alternative and local-language names, searchable but never displayed.
# Keyed by (displayed label, country).
ALIASES = {
    ('Prague', 'Czechia'): 'Praha',
    ('Plzeň', 'Czechia'): 'Pilsen Plzen',
    ('Brno', 'Czechia'): 'Bruenn Brunn',
    ('Vienna', 'Austria'): 'Wien',
    ('Munich', 'Germany'): 'Muenchen München',
    ('Cologne', 'Germany'): 'Koeln Köln',
    ('Nürnberg', 'Germany'): 'Nuremberg Nuernberg',
    ('Frankfurt', 'Germany'): 'Frankfurt am Main',
    ('Rome', 'Italy'): 'Roma',
    ('Milan', 'Italy'): 'Milano',
    ('Naples', 'Italy'): 'Napoli',
    ('Turin', 'Italy'): 'Torino',
    ('Florence', 'Italy'): 'Firenze',
    ('Venice', 'Italy'): 'Venezia',
    ('Genoa', 'Italy'): 'Genova',
    ('Lisbon', 'Portugal'): 'Lisboa',
    ('Seville', 'Spain'): 'Sevilla',
    ('Geneva', 'Switzerland'): 'Geneve Genf Ginevra',
    ('Copenhagen', 'Denmark'): 'Kobenhavn København',
    ('Göteborg', 'Sweden'): 'Gothenburg',
    ('Warsaw', 'Poland'): 'Warszawa',
    ('Gdańsk', 'Poland'): 'Gdansk Danzig',
    ('Wrocław', 'Poland'): 'Wroclaw Breslau',
    ('Moscow', 'Russia'): 'Moskva',
    ('St. Petersburg', 'Russia'): 'Sankt Peterburg Leningrad Saint Petersburg',
    ('Bucharest', 'Romania'): 'Bucuresti București',
    ('Belgrade', 'Serbia'): 'Beograd',
    ('Athens', 'Greece'): 'Athina Athinai',
    ('Thessaloniki', 'Greece'): 'Salonica',
    ('Brussels', 'Belgium'): 'Bruxelles Brussel',
    ('Antwerpen', 'Belgium'): 'Antwerp Anvers',
    ('The Hague', 'Netherlands'): 'Den Haag s-Gravenhage',
    ('Helsinki', 'Finland'): 'Helsingfors',
    ('Kyiv', 'Ukraine'): 'Kiev',
    ('Lviv', 'Ukraine'): 'Lvov Lemberg Lwow',
    ('Kharkiv', 'Ukraine'): 'Kharkov',
    ('Odesa', 'Ukraine'): 'Odessa',
    ('Dnipro', 'Ukraine'): 'Dnipropetrovsk',
    ('Beijing', 'China'): 'Peking',
    ('Guangzhou', 'China'): 'Canton',
    ('Mumbai', 'India'): 'Bombay',
    ('Kolkata', 'India'): 'Calcutta',
    ('Chennai', 'India'): 'Madras',
    ('Bengaluru', 'India'): 'Bangalore',
    ('Ho Chi Minh City', 'Vietnam'): 'Saigon',
    ('Yangon', 'Myanmar'): 'Rangoon',
    ('Ulaanbaatar', 'Mongolia'): 'Ulan Bator',
    ('Almaty', 'Kazakhstan'): 'Alma-Ata',
    ('Tehran', 'Iran'): 'Teheran',
    ('Cairo', 'Egypt'): 'Al Qahirah',
    ('Marrakesh', 'Morocco'): 'Marrakech',
    ('Mexico City', 'Mexico'): 'Ciudad de Mexico CDMX',
    ('Havana', 'Cuba'): 'La Habana',
    ('Kiritimati', 'Kiribati'): 'Christmas Island',
    ('Nuuk', 'Greenland'): 'Godthab',
    ('Tallinn', 'Estonia'): 'Reval',
    ('Vilnius', 'Lithuania'): 'Wilno',
    ('Košice', 'Slovakia'): 'Kosice',
    ('UTC', 'Coordinated Universal Time'): 'GMT Zulu Greenwich',
}

US_STATES = {
 'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
 'Connecticut':'CT','Delaware':'DE','District of Columbia':'DC','Florida':'FL','Georgia':'GA',
 'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY',
 'Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN',
 'Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH',
 'New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',
 'Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI',
 'South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
 'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
 'Puerto Rico':'PR',
}
CA_PROV = {
 'Alberta':'AB','British Columbia':'BC','Manitoba':'MB','New Brunswick':'NB',
 'Newfoundland and Labrador':'NL','Newfoundland':'NL','Nova Scotia':'NS','Ontario':'ON',
 'Prince Edward Island':'PE','Quebec':'QC','Québec':'QC','Saskatchewan':'SK',
 'Northwest Territories':'NT','Nunavut':'NU','Yukon':'YT',
}
AU_STATE = {
 'New South Wales':'NSW','Victoria':'VIC','Queensland':'QLD','South Australia':'SA',
 'Western Australia':'WA','Tasmania':'TAS','Northern Territory':'NT',
 'Australian Capital Territory':'ACT',
}

# Cities that must be present regardless of population (capitals, tz-distinctive places).
EXTRAS = {
 ('Reykjavik','Iceland'), ('Reykjavík','Iceland'), ('Nuuk','Greenland'), ('Torshavn','Faroe Islands'),
 ('Tórshavn','Faroe Islands'), ('Luxembourg','Luxembourg'), ('Monaco','Monaco'), ('Andorra','Andorra'),
 ('Andorra la Vella','Andorra'), ('San Marino','San Marino'), ('Vaduz','Liechtenstein'),
 ('Valletta','Malta'), ('Podgorica','Montenegro'), ('Ljubljana','Slovenia'), ('Tallinn','Estonia'),
 ('Riga','Latvia'), ('Vilnius','Lithuania'), ('Chisinau','Moldova'), ('Bern','Switzerland'),
 ('Wellington','New Zealand'), ('Auckland','New Zealand'), ('Suva','Fiji'), ('Apia','Samoa'),
 ('Nukualofa','Tonga'), ("Nuku'alofa",'Tonga'), ('Port Moresby','Papua New Guinea'),
 ('Honiara','Solomon Islands'), ('Port Vila','Vanuatu'), ('Noumea','New Caledonia'),
 ('Papeete','French Polynesia'), ('Pago Pago','American Samoa'), ('Hagatna','Guam'),
 ('Majuro','Marshall Islands'), ('Palikir','Micronesia'), ('Yaren','Nauru'), ('Funafuti','Tuvalu'),
 ('Avarua','Cook Islands'), ('Alofi','Niue'), ('Adamstown','Pitcairn Islands'),
 ('Darwin','Australia'), ('Hobart','Australia'), ('Canberra','Australia'), ('Perth','Australia'),
 ('Adelaide','Australia'), ('Brisbane','Australia'),
 ('Anchorage','United States'), ('Honolulu','United States'), ('Juneau','United States'),
 ('Whitehorse','Canada'), ('Yellowknife','Canada'), ('Iqaluit','Canada'), ('St. John’s','Canada'),
 ("St. John's",'Canada'), ('Halifax','Canada'), ('Winnipeg','Canada'), ('Regina','Canada'),
 ('Thimphu','Bhutan'), ('Male','Maldives'), ('Ulaanbaatar','Mongolia'), ('Vientiane','Laos'),
 ('Bandar Seri Begawan','Brunei'), ('Dili','East Timor'), ('Bishkek','Kyrgyzstan'),
 ('Ashgabat','Turkmenistan'), ('Dushanbe','Tajikistan'), ('Tbilisi','Georgia'),
 ('Yerevan','Armenia'), ('Baku','Azerbaijan'), ('Nicosia','Cyprus'), ('Beirut','Lebanon'),
 ('Amman','Jordan'), ('Jerusalem','Israel'), ('Doha','Qatar'), ('Manama','Bahrain'),
 ('Kuwait City','Kuwait'), ('Muscat','Oman'), ('Abu Dhabi','United Arab Emirates'),
 ('Gaborone','Botswana'), ('Windhoek','Namibia'), ('Maseru','Lesotho'), ('Mbabane','Eswatini'),
 ('Port Louis','Mauritius'), ('Victoria','Seychelles'), ('Moroni','Comoros'),
 ('Praia','Cabo Verde'), ('Banjul','Gambia'), ('Bissau','Guinea-Bissau'), ('Malabo','Equatorial Guinea'),
 ('Sao Tome','Sao Tome and Principe'), ('Djibouti','Djibouti'), ('Asmara','Eritrea'),
 ('Belmopan','Belize'), ('San Jose','Costa Rica'), ('Panama City','Panama'),
 ('Nassau','Bahamas'), ('Bridgetown','Barbados'), ('Castries','Saint Lucia'),
 ('Kingstown','Saint Vincent and the Grenadines'), ("Saint George's",'Grenada'),
 ('Roseau','Dominica'), ("St. John's",'Antigua and Barbuda'), ('Basseterre','Saint Kitts and Nevis'),
 ('Port of Spain','Trinidad and Tobago'), ('Georgetown','Guyana'), ('Paramaribo','Suriname'),
 ('Cayenne','French Guiana'), ('Stanley','Falkland Islands'), ('Montevideo','Uruguay'),
 ('Asuncion','Paraguay'), ('Sucre','Bolivia'), ('Quito','Ecuador'), ('Galapagos','Ecuador'),
 ('Ushuaia','Argentina'), ('Manaus','Brazil'), ('Fortaleza','Brazil'),
 ('Gibraltar','Gibraltar'), ('Ponta Delgada','Portugal'), ('Las Palmas','Spain'),
 ('Tirana','Albania'), ('Sarajevo','Bosnia and Herzegovina'), ('Skopje','North Macedonia'),
 ('Pristina','Kosovo'), ('Zagreb','Croatia'), ('Bratislava','Slovakia'), ('Brno','Czechia'),
 ('Ostrava','Czechia'), ('Minsk','Belarus'), ('Kiev','Ukraine'), ('Kyiv','Ukraine'),
 ('Vladivostok','Russia'), ('Novosibirsk','Russia'), ('Yekaterinburg','Russia'),
 ('Irkutsk','Russia'), ('Kaliningrad','Russia'), ('Petropavlovsk-Kamchatskiy','Russia'),
 ('Kathmandu','Nepal'), ('Colombo','Sri Lanka'), ('Yangon','Myanmar'), ('Phnom Penh','Cambodia'),
 ('Macau','Macau'), ('Hong Kong','Hong Kong'), ('Singapore','Singapore'),
}

# Places the population filter cannot reach, but whose UTC offsets people actually need.
MANUAL = [
    ('UTC', 'Coordinated Universal Time', 'UTC', 0.0, 0.0, 400000),
    ('Kiritimati', 'Kiribati', 'Pacific/Kiritimati', 1.87, -157.43, 8000),
    ('Tarawa', 'Kiribati', 'Pacific/Tarawa', 1.33, 172.98, 63000),
    ('Chatham Islands', 'New Zealand', 'Pacific/Chatham', -43.95, -176.55, 600),
    ('Marquesas Islands', 'French Polynesia', 'Pacific/Marquesas', -9.78, -139.05, 9300),
    ('Norfolk Island', 'Australia', 'Pacific/Norfolk', -29.04, 167.95, 2200),
    ('Lord Howe Island', 'Australia', 'Australia/Lord_Howe', -31.55, 159.08, 400),
    ('Eucla', 'Australia', 'Australia/Eucla', -31.68, 128.88, 400),
    ('Adamstown', 'Pitcairn Islands', 'Pacific/Pitcairn', -25.07, -130.1, 50),
    ('Midway Atoll', 'United States', 'Pacific/Midway', 28.2, -177.38, 40),
    ('Kathmandu', 'Nepal', 'Asia/Kathmandu', 27.72, 85.32, 895000),
    ('Kolkata', 'India', 'Asia/Kolkata', 22.57, 88.36, 14000000),
    ('Tehran', 'Iran', 'Asia/Tehran', 35.7, 51.42, 8700000),
    ('Kabul', 'Afghanistan', 'Asia/Kabul', 34.53, 69.17, 4400000),
    ('Yangon', 'Myanmar', 'Asia/Yangon', 16.8, 96.15, 5200000),
    ('Nuuk', 'Greenland', 'America/Nuuk', 64.18, -51.72, 18000),
    ('Ittoqqortoormiit', 'Greenland', 'America/Scoresbysund', 70.48, -21.97, 350),
    ('Tórshavn', 'Faroe Islands', 'Atlantic/Faroe', 62.01, -6.77, 13000),
    ('Ponta Delgada', 'Portugal', 'Atlantic/Azores', 37.74, -25.67, 68000),
    ('Praia', 'Cabo Verde', 'Atlantic/Cape_Verde', 14.92, -23.51, 159000),
    ('Stanley', 'Falkland Islands', 'Atlantic/Stanley', -51.7, -57.85, 2500),
    ('South Georgia', 'South Georgia', 'Atlantic/South_Georgia', -54.28, -36.51, 30),
    ('St. John\u2019s', 'Canada', 'America/St_Johns', 47.56, -52.71, 108000),
    ('Caracas', 'Venezuela', 'America/Caracas', 10.5, -66.92, 3000000),
    ('Galapagos', 'Ecuador', 'Pacific/Galapagos', -0.74, -90.31, 25000),
    ('Easter Island', 'Chile', 'Pacific/Easter', -27.15, -109.43, 7700),
    ('McMurdo Station', 'Antarctica', 'Antarctica/McMurdo', -77.85, 166.67, 1000),
    ('Palmer Station', 'Antarctica', 'Antarctica/Palmer', -64.77, -64.05, 40),
    ('Honiara', 'Solomon Islands', 'Pacific/Guadalcanal', -9.43, 159.95, 85000),
    ('Port Vila', 'Vanuatu', 'Pacific/Efate', -17.73, 168.32, 51000),
    ('Nouméa', 'New Caledonia', 'Pacific/Noumea', -22.28, 166.46, 100000),
    ('Papeete', 'French Polynesia', 'Pacific/Tahiti', -17.54, -149.57, 137000),
    ('Apia', 'Samoa', 'Pacific/Apia', -13.83, -171.77, 37000),
    ('Pago Pago', 'American Samoa', 'Pacific/Pago_Pago', -14.28, -170.7, 11500),
    ("Nuku'alofa", 'Tonga', 'Pacific/Tongatapu', -21.14, -175.2, 23000),
    ('Suva', 'Fiji', 'Pacific/Fiji', -18.14, 178.44, 93000),
    ('Funafuti', 'Tuvalu', 'Pacific/Funafuti', -8.52, 179.2, 6300),
    ('Yaren', 'Nauru', 'Pacific/Nauru', -0.55, 166.92, 1100),
    ('Majuro', 'Marshall Islands', 'Pacific/Majuro', 7.09, 171.38, 28000),
    ('Palikir', 'Micronesia', 'Pacific/Pohnpei', 6.92, 158.16, 6200),
    ('Hagåtña', 'Guam', 'Pacific/Guam', 13.48, 144.75, 1100),
    ('Avarua', 'Cook Islands', 'Pacific/Rarotonga', -21.21, -159.78, 5400),
    ('Alofi', 'Niue', 'Pacific/Niue', -19.06, -169.92, 600),
    ('Gibraltar', 'Gibraltar', 'Europe/Gibraltar', 36.14, -5.35, 34000),
    ('Vaduz', 'Liechtenstein', 'Europe/Vaduz', 47.14, 9.52, 5700),
    ('Monaco', 'Monaco', 'Europe/Monaco', 43.74, 7.42, 39000),
    ('San Marino', 'San Marino', 'Europe/San_Marino', 43.94, 12.45, 34000),
    ('Vatican', 'Vatican', 'Europe/Vatican', 41.9, 12.45, 800),
    ('Andorra la Vella', 'Andorra', 'Europe/Andorra', 42.51, 1.52, 22000),
    ('Longyearbyen', 'Svalbard', 'Arctic/Longyearbyen', 78.22, 15.63, 2400),
]


def norm(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii','ignore').decode().lower()

def fetch(src: Path) -> None:
    if src.exists():
        return
    src.parent.mkdir(parents=True, exist_ok=True)
    print(f'downloading {UPSTREAM}')
    urllib.request.urlretrieve(UPSTREAM, src)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('src', nargs='?', type=Path, default=CACHE / 'cityMap.json')
    ap.add_argument('out', nargs='?', type=Path, default=ROOT / 'data' / 'cities.json')
    args = ap.parse_args()

    fetch(args.src)
    raw = json.loads(args.src.read_text(encoding='utf-8'))
    seen = {}
    for c in raw:
        country = COUNTRY_FIX.get(c.get('country') or '', c.get('country') or '')
        city = (c.get('city') or '').strip()
        city = NAME_FIX.get(city, city)
        tz = c.get('timezone') or ''
        if not city or not tz or not country:
            continue
        pop = c.get('pop') or 0
        keep = pop >= 150000 or (city, country) in EXTRAS
        if not keep:
            continue
        prov = (c.get('province') or '').strip()
        abbr = US_STATES.get(prov) if country == 'United States' else None
        label = f'{city}, {abbr}' if abbr else city
        key = (norm(label), country, tz)
        if key in seen and (seen[key].get('pop') or 0) >= pop:
            continue
        seen[key] = {
            'label': label, 'city': city, 'country': country, 'tz': tz,
            'lat': round(float(c['lat']), 3), 'lng': round(float(c['lng']), 3), 'pop': pop,
        }

    for label, country, tz, lat, lng, pop in MANUAL:
        label = NAME_FIX.get(label, label)
        key = (norm(label), country, tz)
        if key in seen:
            continue
        seen[key] = {'label': label, 'city': label, 'country': country, 'tz': tz,
                     'lat': lat, 'lng': lng, 'pop': pop}

    cities = sorted(seen.values(), key=lambda x: (-x['pop'], x['label']))
    tzs = sorted({c['tz'] for c in cities})
    tzi = {t: i for i, t in enumerate(tzs)}
    countries = sorted({c['country'] for c in cities})
    ci = {c: i for i, c in enumerate(countries)}

    rows = []
    used_aliases = set()
    for c in cities:
        key = (c['label'], c['country'])
        alias = ALIASES.get(key)
        if alias:
            used_aliases.add(key)
        row = [c['label'], ci[c['country']], tzi[c['tz']], c['lat'], c['lng'],
               int(round(c['pop']))]
        if alias:
            row.append(alias)
        rows.append(row)

    missing = sorted(set(ALIASES) - used_aliases)
    if missing:
        print(f'WARNING: {len(missing)} alias entries matched no city:')
        for key in missing:
            print('   ', key)

    out = {'tz': tzs, 'countries': countries, 'cities': rows}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8'
    )
    print(
        f'{args.out}: cities={len(rows)} timezones={len(tzs)} countries={len(countries)}'
    )


if __name__ == '__main__':
    main()
