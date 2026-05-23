import fs from 'fs';

const riskMap = JSON.parse(fs.readFileSync('tmp/pipeline/risk-map.json', 'utf8'));

// Update the ads module with coverage information from our analysis
const adsModule = riskMap.modules.find(m => m.name === 'ads');
if (adsModule) {
  adsModule.coverage = 'none';
  adsModule.coverage_specs = [
    'tests/integration/ad-beacons.spec.ts',
    'tests/integration/google-dai-dash.spec.ts',
    'tests/integration/ads-sgai.spec.ts',
    'tests/e2e/events.spec.ts',
    'tests/e2e/player-api.spec.ts'
  ];
  adsModule.open_gaps = 3;
  adsModule.test_result = 'pending';
  adsModule.verdict = 'NEW_TESTS_REQUIRED';
}

fs.writeFileSync('tmp/pipeline/risk-map.json', JSON.stringify(riskMap, null, 2));
console.log('Risk map updated with coverage info');
