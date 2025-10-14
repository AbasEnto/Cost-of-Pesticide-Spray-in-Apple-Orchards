// app.js - rewritten: main outputs show TOTAL for entered area,
// breakdown shows per-kanal + totals. Safe defaults + validations.

(async function () {
  // load lookup data
  const data = await fetch('data.json').then(r => {
    if (!r.ok) throw new Error('Could not load data.json');
    return r.json();
  });

  // UI elements
  const systemEl = document.getElementById('system');
  const ageEl = document.getElementById('age');
  const insectEl = document.getElementById('insecticide');
  const methodEl = document.getElementById('method');
  const areaEl = document.getElementById('area');
  const calcBtn = document.getElementById('calcBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toggleBreakdownBtn = document.getElementById('toggleBreakdownBtn');

  const materialVal = document.getElementById('materialVal');
  const applicationVal = document.getElementById('applicationVal');
  const totalVal = document.getElementById('totalVal');
  const breakdownBox = document.getElementById('breakdownBox');

  // friendly labels for system dropdown (keeps value keys same as data.json)
  const systemLabels = {
    traditional: "Traditional Orchard",
    high: "High Density Orchard",
    medium: "Medium Density Orchard"
  };

  // populate orchard systems
  const systems = Object.keys(data.sprayVolume);
  systems.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = systemLabels[s] || s;
    systemEl.appendChild(opt);
  });

  // populate ages for selected system
  function populateAges() {
    ageEl.innerHTML = '';
    const ages = Object.keys(data.sprayVolume[systemEl.value]);
    ages.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      ageEl.appendChild(opt);
    });
  }

  // populate insecticides
  Object.keys(data.costPer100L).forEach(k => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = k;
    insectEl.appendChild(o);
  });

  // initial population
  populateAges();
  systemEl.addEventListener('change', populateAges);

  // utility: clamp area etc.
  function getArea() {
    const raw = parseFloat(areaEl.value);
    if (Number.isFinite(raw) && raw > 0) return raw;
    return 1; // default
  }

  // get RVF table lookup (floor into 1..10)
  function getRVF(ageYears) {
    const idx = Math.min(10, Math.max(1, Math.floor(ageYears)));
    return data.rvf[String(idx)] ?? 0.4;
  }

  // compute material cost PER KANAL
  function computeMaterialCostPerKanal(insecticide, system, age) {
    const cost100 = Number(data.costPer100L[insecticide] || 0);
    const volume = Number(data.sprayVolume[system]?.[age] ?? 0);
    const materialPerKanal = cost100 * (volume / 100);
    return { materialPerKanal, cost100, volume };
  }

  // compute fixed cost per hour (ASA or Straight Line)
  function computeFixedPerHour(method) {
    const m = data.defaults.machine;
    const econ = data.defaults.economic;
    const H = Number(m.annualHours);
    const L = Number(m.expectedLifeYears);
    const C = Number(m.purchasePrice);

    let salvage;
    if (method === 'ASA') {
      salvage = Number(m.currentListPrice) * getRVF(Number(m.machineAgeYears));
    } else {
      salvage = 0.10 * C; // straight-line 10% salvage
    }

    const totalDep = C - salvage;
    const annualDep = totalDep / L;
    const dep_per_hr = annualDep / H;
    const avgInvestment = (C + salvage) / 2;
    const interest_per_hr = (avgInvestment * Number(econ.realInterestRate)) / H;
    const tih_per_hr = (avgInvestment * Number(econ.TIH_rate)) / H;

    return {
      dep_per_hr,
      interest_per_hr,
      tih_per_hr,
      fixed_per_hr: dep_per_hr + interest_per_hr + tih_per_hr
    };
  }

  // compute variable costs per hour
  function computeVariablePerHour() {
    const m = data.defaults.machine;
    const op = data.defaults.operational;
    const H = Number(m.annualHours);
    const C = Number(m.purchasePrice);

    const repairs_per_hr = (Number(op.repair_pct_per_year) * C) / H;
    const fuel_per_hr = Number(op.fuel_l_per_hr) * Number(op.fuel_price_per_L);
    const lube_per_hr = Number(op.lubrication_pct) * fuel_per_hr;
    const labour_per_hr = (Number(op.numLabourUnits) * Number(op.wage_per_day)) / Number(op.workday_hours);

    const variable_per_hr = repairs_per_hr + fuel_per_hr + lube_per_hr + labour_per_hr;
    return { repairs_per_hr, fuel_per_hr, lube_per_hr, labour_per_hr, variable_per_hr };
  }

  // compute hours per kanal (document buckets)
  function computeHoursPerKanal(volume) {
    const hb = data.defaults.hours_bucket;
    if (volume <= hb.typeI_max_L) return hb.typeI_hours_per_kanal;
    return hb.typeII_hours_per_kanal;
  }

  // compute full results for chosen method (values PER KANAL)
  function computePerKanalResults(system, age, insecticide, method) {
    const mat = computeMaterialCostPerKanal(insecticide, system, age);
    const fixed = computeFixedPerHour(method);
    const variable = computeVariablePerHour();
    const total_hourly = fixed.fixed_per_hr + variable.variable_per_hr;
    const hours_per_kanal = computeHoursPerKanal(mat.volume);
    const application_per_kanal = total_hourly * hours_per_kanal;
    const total_per_kanal = mat.materialPerKanal + application_per_kanal;

    return {
      materialPerKanal: mat.materialPerKanal,
      material_details: mat,
      fixed,
      variable,
      total_hourly,
      hours_per_kanal,
      application_per_kanal,
      total_per_kanal
    };
  }

  // Display results: MAIN outputs show TOTALS (for area), breakdown shows both per-kanal and totals
  function displayResults(system, age, insect, method, area) {
    // compute per-kanal results
    const res = computePerKanalResults(system, age, insect, method);

    // totals
    const materialTotal = res.materialPerKanal * area;
    const applicationTotal = res.application_per_kanal * area;
    const grandTotal = res.total_per_kanal * area;

    // MAIN output: show Totals (Rs.)
    materialVal.textContent = materialTotal.toFixed(2);
    applicationVal.textContent = applicationTotal.toFixed(2);
    totalVal.textContent = grandTotal.toFixed(2);

    // Prepare breakdown: include per-kanal and totals
    breakdownBox.innerHTML = `
      <div><strong>Breakdown (${method} method)</strong></div>
      <div class="muted" style="margin-top:6px">
        <div><strong>Per kanal</strong></div>
        <div>Spray volume (L/kanal): <strong>${res.material_details.volume}</strong></div>
        <div>Material cost (per kanal): Rs ${res.materialPerKanal.toFixed(2)}</div>
        <div>Application cost (per kanal): Rs ${res.application_per_kanal.toFixed(2)}</div>
        <div>Total (per kanal): Rs ${res.total_per_kanal.toFixed(2)}</div>

        <div style="margin-top:8px"><strong>Hourly components</strong></div>
        <div>Depreciation per hr: Rs ${res.fixed.dep_per_hr.toFixed(2)}</div>
        <div>Interest per hr: Rs ${res.fixed.interest_per_hr.toFixed(2)}</div>
        <div>TIH per hr: Rs ${res.fixed.tih_per_hr.toFixed(2)}</div>
        <div>Repairs per hr: Rs ${res.variable.repairs_per_hr.toFixed(2)}</div>
        <div>Fuel per hr: Rs ${res.variable.fuel_per_hr.toFixed(2)}</div>
        <div>Lubrication per hr: Rs ${res.variable.lube_per_hr.toFixed(2)}</div>
        <div>Labour per hr: Rs ${res.variable.labour_per_hr.toFixed(2)}</div>
        <div>Total hourly cost: Rs ${res.total_hourly.toFixed(2)}</div>

        <div style="margin-top:8px"><strong>For ${area} kanal (TOTAL)</strong></div>
        <div>Material total: Rs ${materialTotal.toFixed(2)}</div>
        <div>Application total: Rs ${applicationTotal.toFixed(2)}</div>
        <div><strong>Grand total: Rs ${grandTotal.toFixed(2)}</strong></div>
      </div>
    `;
  }

  // Hook up buttons and behavior
  calcBtn.addEventListener('click', () => {
    const sys = systemEl.value;
    const age = ageEl.value;
    const insect = insectEl.value;
    const method = methodEl.value;
    const area = Math.max(0.001, Number(areaEl.value) || 1);

    // basic validation: ensure lookup keys exist
    if (!data.sprayVolume[sys]) {
      alert('Invalid orchard system selected.');
      return;
    }
    if (!data.sprayVolume[sys][age]) {
      alert('Invalid age group for selected system.');
      return;
    }
    if (!data.costPer100L[insect]) {
      alert('Invalid insecticide selection.');
      return;
    }

    displayResults(sys, age, insect, method, area);
  });

  resetBtn.addEventListener('click', () => {
    systemEl.selectedIndex = 0;
    populateAges();
    insectEl.selectedIndex = 0;
    methodEl.selectedIndex = 0;
    areaEl.value = '1';
    materialVal.textContent = '—';
    applicationVal.textContent = '—';
    totalVal.textContent = '—';
    breakdownBox.innerHTML = '';
    breakdownBox.style.display = 'none';
  });

  // toggle breakdown visibility
  toggleBreakdownBtn.addEventListener('click', () => {
    if (breakdownBox.style.display === 'none' || !breakdownBox.style.display) {
      breakdownBox.style.display = 'block';
      toggleBreakdownBtn.textContent = 'Hide Detailed Breakdown';
    } else {
      breakdownBox.style.display = 'none';
      toggleBreakdownBtn.textContent = 'See Detailed Breakdown';
    }
  });

  // initial calc with defaults
  calcBtn.click();

})();
