/**
 * @file docs/app.js
 * Interactive Client Logic for Alloy.js GitHub Pages
 */

import {
  compressText,
  estimateTokens,
  optimizePayload,
  runLiveTest,
  MODEL_PRICING
} from './alloy-web.js';

// Preset Prompts Catalog
const PRESETS = {
  underwriting: `Commercial Underwriting Submission: 'Apex Global Cold Storage'

General Notes:
*   Facility Age: 6 years
*   Construction Type: Reinforced Concrete

--------------------------------------------------
STRUCTURAL & FIRE SAFETY AUDIT DATA:
--------------------------------------------------
{
    "facilityId": "FAC-98421",
    "address": {
        "street": "742 Evergreen Logistics Blvd",
        "city": "Springfield",
        "state": "IL",
        "zip": "62704"
    },
    "specifications": {
        "grossAreaSqft": 185000,
        "refrigeratedAreaSqft": 140000,
        "ceilingHeightFeet": 36,
        "loadingDocks": 18,
        "yearBuilt": 2019
    },
    "safetySystems": {
        "esfrSprinklers": true,
        "centralStationAlarm": true,
        "backupGeneratorsCount": 2,
        "lastInspectionDate": "2024-11-15",
        "fireSuppressionRating": "Class-A",
        "violationsPast3Years": 0
    },
    "hazardClassification": {
        "combustibleLoading": "Low",
        "chemicalStorage": false,
        "ammoniaRefrigerationSystem": {
            "present": true,
            "ppmSensorsInstalled": true,
            "autoShutoffValves": true,
            "lastCertified": "2024-10-01"
        }
    },
    "lossHistory": [
        {
            "year": 2022,
            "claimType": "Equipment Breakdown - Compressor",
            "incurredAmount": 14200,
            "status": "Closed"
        }
    ]
}

--------------------------------------------------
Please evaluate this building safety risk and summarize in 2 concise sentences.`,

  devops: `==================================================
AWS ECS DEPLOYMENT REFERENCE ARCHITECTURE
==================================================

*   Target Cluster: production-us-east-1
*   Task Definition CPU: 1024
*   Task Definition Memory: 2048
*   Container Port: 8080

--------------------------------------------------
Standard Deployment Task Definition Template:
\`\`\`json
{
  "family": "api-service",
  "networkMode": "awsvpc",
  "requiresCompatibilities": [
    "FARGATE"
  ],
  "containerDefinitions": [
    {
      "name": "web",
      "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/app:v2.4.1",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8080
        }
      ]
    }
  ]
}
\`\`\`
--------------------------------------------------

Query from DevOps Engineer:
How should I set up the port mapping and network mode according to the guideline above?`,

  medical: `Clinical Inpatient Assessment Record
Patient ID: #983-021
Attending Physician: Dr. Marcus Vance, MD

--------------------------------------------------
PATIENT VITALS & LAB PANEL:
--------------------------------------------------
{
  "encounter": "2026-03-02T14:30:00Z",
  "vitals": {
    "bloodPressure": "128/84",
    "heartRateBpm": 74,
    "respiratoryRate": 16,
    "o2Saturation": 98.5
  },
  "diagnoses": [
    { "code": "I10", "description": "Essential (primary) hypertension" },
    { "code": "E11.9", "description": "Type 2 diabetes mellitus without complications" }
  ],
  "medications": [
    { "name": "Lisinopril", "dosage": "10mg daily", "adherence": "High" },
    { "name": "Metformin", "dosage": "500mg twice daily", "adherence": "High" }
  ]
}

--------------------------------------------------
Summarize this patient's current medication regimen and highlight any contraindications.`,

  rag: `You are an AI support assistant for a banking platform.

Here is the retrieved customer context:
*   Account Number: 4092-1823-9901
*   Account Status: Active
*   Verified KYC: true

Recent transactions history:
[
  { "id": "TX-101", "date": "2026-09-01", "amount": 142.50, "merchant": "Whole Foods" },
  { "id": "TX-102", "date": "2026-09-03", "amount": 18.00, "merchant": "Metro Transit" },
  { "id": "TX-103", "date": "2026-09-05", "amount": 540.00, "merchant": "Delta Airlines" }
]

Customer Question:
Did my airline ticket purchase go through successfully?`
};

// DOM Elements
const promptInput = document.getElementById('prompt-input');
const presetSelect = document.getElementById('preset-select');
const providerSelect = document.getElementById('provider-select');
const toggleCode = document.getElementById('toggle-code');
const toggleJson = document.getElementById('toggle-json');
const toggleMarkdown = document.getElementById('toggle-markdown');

const rawTokenBadge = document.getElementById('raw-token-badge');
const optimizedTokenBadge = document.getElementById('optimized-token-badge');
const optimizedOutput = document.getElementById('optimized-output');
const providerOutputBadge = document.getElementById('provider-output-badge');
const btnCopyOptimized = document.getElementById('btn-copy-optimized');
const btnRunLiveTest = document.getElementById('btn-run-live-test');
const liveTestResult = document.getElementById('live-test-result');

// Telemetry Elements
const statCharsSaved = document.getElementById('stat-chars-saved');
const statTokensSaved = document.getElementById('stat-tokens-saved');
const statPercentSaved = document.getElementById('stat-percent-saved');
const statCostSaved = document.getElementById('stat-cost-saved');

// ROI Calculator Elements
const sliderCalls = document.getElementById('slider-calls');
const displayCalls = document.getElementById('display-calls');
const selectCalcModel = document.getElementById('select-calc-model');
const sliderCache = document.getElementById('slider-cache');
const displayCache = document.getElementById('display-cache');
const sliderTokens = document.getElementById('slider-tokens');
const displayTokens = document.getElementById('display-tokens');

const calcMonthlySavings = document.getElementById('calc-monthly-savings');
const calcAnnualSavings = document.getElementById('calc-annual-savings');
const calcBaselineSpend = document.getElementById('calc-baseline-spend');
const calcAlloySpend = document.getElementById('calc-alloy-spend');
const calcTokensIntercepted = document.getElementById('calc-tokens-intercepted');
const calcBadgeReduction = document.getElementById('calc-badge-reduction');

// Code tab elements
const codeTabs = document.querySelectorAll('.code-tab');
const codeTabContents = document.querySelectorAll('.code-tab-content');

// Helper to format currency
function formatUSD(num) {
  if (num >= 1000) {
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 1. Live Playground Optimization Handler
function runPlaygroundOptimization() {
  const rawText = promptInput.value || '';
  const provider = providerSelect.value;
  const options = {
    preserveCodeBlocks: toggleCode.checked,
    enableJsonMinification: toggleJson.checked,
    markdownDeclutter: toggleMarkdown.checked
  };

  const rawChars = rawText.length;
  const rawTokens = estimateTokens(rawText);

  // Construct mock messages
  const mockMessages = [
    { role: 'user', content: rawText }
  ];

  const optimizedPayloadResult = optimizePayload(mockMessages, provider, options);

  let formattedOutput = '';
  if (provider === 'gemini') {
    formattedOutput = JSON.stringify(optimizedPayloadResult, null, 2);
    providerOutputBadge.textContent = 'Gemini Format';
  } else if (provider === 'anthropic') {
    formattedOutput = JSON.stringify(optimizedPayloadResult, null, 2);
    providerOutputBadge.textContent = 'Anthropic Ephemeral';
  } else if (provider === 'vllm') {
    formattedOutput = JSON.stringify(optimizedPayloadResult, null, 2);
    providerOutputBadge.textContent = 'vLLM OpenAI Format';
  } else {
    formattedOutput = JSON.stringify(optimizedPayloadResult, null, 2);
    providerOutputBadge.textContent = 'OpenAI Format';
  }

  optimizedOutput.querySelector('code').textContent = formattedOutput;

  // Extract pure optimized text for token count
  const optimizedText = compressText(rawText, options);
  const optimizedChars = optimizedText.length;
  const optimizedTokens = estimateTokens(optimizedText);

  const charsSaved = Math.max(0, rawChars - optimizedChars);
  const tokensSaved = Math.max(0, rawTokens - optimizedTokens);
  const percentSaved = rawTokens > 0 ? ((tokensSaved / rawTokens) * 100).toFixed(1) : '0.0';

  // Cost saved on 1M calls using Gemini 2.5 Flash ($0.075 / 1M)
  const costSaved1M = (tokensSaved / 1_000_000) * 0.075 * 1_000_000;

  // Update badges & telemetry
  rawTokenBadge.textContent = `${rawTokens} tokens (${rawChars} chars)`;
  optimizedTokenBadge.textContent = `${optimizedTokens} tokens (-${percentSaved}%)`;

  statCharsSaved.textContent = charsSaved.toLocaleString();
  statTokensSaved.textContent = tokensSaved.toLocaleString();
  statPercentSaved.textContent = `${percentSaved}%`;
  statCostSaved.textContent = `$${costSaved1M.toFixed(2)}`;
}

async function runBrowserSmokeTest() {
  btnRunLiveTest.disabled = true;
  btnRunLiveTest.textContent = 'Running…';
  liveTestResult.textContent = 'Executing browser smoke tests…';
  try {
    const result = await runLiveTest();
    liveTestResult.textContent = `${result.passed ? '✓ Passed' : '✕ Failed'} · ${result.checks.filter(check => check.passed).length}/${result.checks.length} checks · ${result.durationMs} ms\n${result.checks.map(check => `${check.passed ? '✓' : '✕'} ${check.name}`).join('\n')}`;
    liveTestResult.classList.toggle('failed', !result.passed);
  } catch (error) {
    liveTestResult.textContent = `✕ Failed: ${error.message}`;
    liveTestResult.classList.add('failed');
  } finally {
    btnRunLiveTest.disabled = false;
    btnRunLiveTest.textContent = 'Run Browser Smoke Test';
  }
}

// 2. ROI Calculator Handler
function updateRoiCalculator() {
  const calls = parseInt(sliderCalls.value, 10);
  const modelKey = selectCalcModel.value;
  const cacheHitRate = parseInt(sliderCache.value, 10) / 100;
  const avgPromptTokens = parseInt(sliderTokens.value, 10);

  // Update displays
  displayCalls.textContent = calls.toLocaleString();
  displayCache.textContent = `${sliderCache.value}%`;
  displayTokens.textContent = `${avgPromptTokens} tokens`;

  const pricing = MODEL_PRICING[modelKey] || MODEL_PRICING['gemini-2.5-flash'];

  // Conservative 30% reduction from AST compression + JSON minification
  const compressionSavingsRate = 0.30;
  const compressedTokens = avgPromptTokens * (1 - compressionSavingsRate);

  // 1. Unoptimized monthly baseline spend
  const baselineInputCost = (calls * avgPromptTokens / 1_000_000) * pricing.inputPer1M;
  // Assume avg 60 output tokens
  const avgOutputTokens = 60;
  const baselineOutputCost = (calls * avgOutputTokens / 1_000_000) * pricing.outputPer1M;
  const totalBaselineSpend = baselineInputCost + baselineOutputCost;

  // 2. Spend with Alloy (Compression + Cache Hits + Output Guardrails)
  // Output guardrails save ~25% output tokens
  const guardedOutputTokens = avgOutputTokens * 0.75;
  const guardedOutputCost = (calls * (1 - cacheHitRate) * guardedOutputTokens / 1_000_000) * pricing.outputPer1M;

  const cacheMissCalls = calls * (1 - cacheHitRate);
  const alloyInputCost = (cacheMissCalls * compressedTokens / 1_000_000) * pricing.inputPer1M;

  const totalAlloySpend = alloyInputCost + guardedOutputCost;
  const monthlySavings = Math.max(0, totalBaselineSpend - totalAlloySpend);
  const annualSavings = monthlySavings * 12;

  const totalNetReductionPct = totalBaselineSpend > 0 ? ((monthlySavings / totalBaselineSpend) * 100).toFixed(1) : 0;
  const tokensInterceptedMillions = ((calls * avgPromptTokens - cacheMissCalls * compressedTokens) / 1_000_000).toFixed(1);

  // Update DOM
  calcMonthlySavings.textContent = formatUSD(monthlySavings);
  calcAnnualSavings.textContent = formatUSD(annualSavings);
  calcBaselineSpend.textContent = formatUSD(totalBaselineSpend) + ' / mo';
  calcAlloySpend.textContent = formatUSD(totalAlloySpend) + ' / mo';
  calcTokensIntercepted.textContent = `${tokensInterceptedMillions}M Tokens / mo`;
  calcBadgeReduction.textContent = `~${totalNetReductionPct}% Total Spend Cut`;
}

// 3. Tab Switcher
codeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    codeTabs.forEach(t => t.classList.remove('active'));
    codeTabContents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    const targetId = `tab-${tab.dataset.tab}`;
    const targetContent = document.getElementById(targetId);
    if (targetContent) targetContent.classList.add('active');
  });
});

// 4. Copy Output to Clipboard
btnCopyOptimized.addEventListener('click', async () => {
  const codeText = optimizedOutput.querySelector('code').textContent;
  try {
    await navigator.clipboard.writeText(codeText);
    btnCopyOptimized.textContent = 'Copied! ✓';
    setTimeout(() => {
      btnCopyOptimized.textContent = 'Copy Output';
    }, 2000);
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
});
btnRunLiveTest.addEventListener('click', runBrowserSmokeTest);

// 5. Preset Change
presetSelect.addEventListener('change', () => {
  const key = presetSelect.value;
  if (PRESETS[key]) {
    promptInput.value = PRESETS[key];
    runPlaygroundOptimization();
  }
});

// 6. Interactive Event Listeners
promptInput.addEventListener('input', runPlaygroundOptimization);
providerSelect.addEventListener('change', runPlaygroundOptimization);
toggleCode.addEventListener('change', runPlaygroundOptimization);
toggleJson.addEventListener('change', runPlaygroundOptimization);
toggleMarkdown.addEventListener('change', runPlaygroundOptimization);

sliderCalls.addEventListener('input', updateRoiCalculator);
selectCalcModel.addEventListener('change', updateRoiCalculator);
sliderCache.addEventListener('input', updateRoiCalculator);
sliderTokens.addEventListener('input', updateRoiCalculator);

// Initial Execution
document.addEventListener('DOMContentLoaded', () => {
  promptInput.value = PRESETS['underwriting'];
  runPlaygroundOptimization();
  updateRoiCalculator();
});

// Run immediately as well in case DOM is already loaded
if (document.readyState !== 'loading') {
  promptInput.value = PRESETS['underwriting'];
  runPlaygroundOptimization();
  updateRoiCalculator();
}
