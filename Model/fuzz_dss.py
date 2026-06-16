import asyncio
import sys
import os
import random

# Tambahkan sys path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.modules.decision_engine.schemas import (
    EvaluateRequest,
    SubBlockInput,
    SubBlockState,
    RuleProfile,
    WeatherContext,
    WeatherWarning,
    DssAction,
    FieldContext
)
from app.modules.decision_engine.engine import evaluate_field

async def run_fuzz_tests():
    print("=== MASSIVE BLACK BOX FUZZ TESTING ===")
    
    test_cases = []
    
    # Helper to create rule profile
    def get_rule():
        return RuleProfile(
            id="rule-test",
            awd_lower_threshold_cm=2.0,
            awd_upper_target_cm=5.0,
            drought_alert_cm=0.0,
            rain_delay_mm=10.0,
            priority_weight=1.0,
            rainfed_modifier_pct=0.0,
            target_confidence="high"
        )
    
    def add_case(name, weather_warn, precip, wl, state_src, rule, expected):
        req = EvaluateRequest(
            job_id=f"job-{len(test_cases)}",
            field_id="field-1",
            cycle_mode="normal",
            field_context=FieldContext(water_source_type="irrigated", operator_count=1),
            weather=WeatherContext(precipitation_mm=precip, temperature_c=30.0, humidity_pct=70.0, is_stale=False),
            active_warnings=weather_warn,
            sub_blocks=[
                SubBlockInput(
                    id=f"sb-{len(test_cases)}",
                    code="TEST",
                    state=SubBlockState(water_level_cm=wl, state_source=state_src, freshness_status="fresh", interpolation_confidence=1.0),
                    crop_cycle=None,
                    rule_profile=rule,
                    management_flags=[],
                    flow_paths=[]
                )
            ]
        )
        test_cases.append((name, req, expected))

    # --- Scenario 1: BMKG Warning (Expected: SKIP_RAINFALL_WARNING or SKIP_WARNING_CRITICAL) ---
    for i in range(20):
        # Even if WL is critical or flooded, weather overrides!
        wl = random.uniform(-5.0, 15.0)
        warning = [WeatherWarning(warning_type="Storm", warning_level="Red", dss_action=DssAction.DELAY_IRRIGATION, warning_text="Badai")]
        add_case("BMKG Warning", warning, 0.0, wl, "observed", get_rule(), "SKIP_RAINFALL_WARNING")

    # --- Scenario 2: Hujan Lebat (Expected: SKIP_RAIN_FORECAST) ---
    for i in range(20):
        wl = random.uniform(-5.0, 15.0)
        precip = random.uniform(10.1, 50.0) # > 10.0
        add_case("Hujan Lebat", [], precip, wl, "observed", get_rule(), "SKIP_RAIN_FORECAST")

    # --- Scenario 3: No Rule Profile (Expected: NO_RULE_PROFILE) ---
    for i in range(15):
        wl = random.uniform(0.0, 10.0)
        add_case("No Rule Profile", [], 0.0, wl, "observed", None, "NO_RULE_PROFILE")

    # --- Scenario 4: Sensor Mati / No Data (Expected: NO_DATA) ---
    for i in range(15):
        add_case("Sensor Mati", [], 0.0, None, "no_data", get_rule(), "NO_DATA")

    # --- Scenario 5: Banjir / Drain Excess (Expected: DRAIN_EXCESS) ---
    for i in range(20):
        # awd_upper_target_cm = 5.0
        wl = random.uniform(5.0, 20.0) # WL >= 5.0
        add_case("Banjir", [], 0.0, wl, "observed", get_rule(), "DRAIN_EXCESS")

    # --- Scenario 6: Irigasi Ambang / Threshold (Expected: IRRIGATE_THRESHOLD) ---
    for i in range(20):
        # awd_lower_threshold_cm = 2.0, drought_alert_cm = 0.0
        # WL > 0.0 and WL <= 2.0
        wl = random.uniform(0.01, 2.0)
        add_case("Irigasi Ambang", [], 0.0, wl, "observed", get_rule(), "IRRIGATE_THRESHOLD")

    # --- Scenario 7: Kritis / Drought Alert (Expected: IRRIGATE_CRITICAL) ---
    for i in range(20):
        # drought_alert_cm = 0.0
        # WL <= 0.0
        wl = random.uniform(-10.0, 0.0)
        add_case("Kritis Kekeringan", [], 0.0, wl, "observed", get_rule(), "IRRIGATE_CRITICAL")

    # --- Scenario 8: Normal / Maintain Dry (Expected: MAINTAIN_AWD_DRY) ---
    for i in range(20):
        # WL > 2.0 and WL < 5.0
        wl = random.uniform(2.01, 4.99)
        add_case("Normal/Aman", [], 0.0, wl, "observed", get_rule(), "MAINTAIN_AWD_DRY")

    print(f"Total Test Cases Generated: {len(test_cases)}")

    # Execute
    results = {
        "CORRECT": 0,
        "INCORRECT": 0,
        "ERROR": 0
    }
    
    breakdown = {}

    for name, req, expected in test_cases:
        try:
            res = await evaluate_field(req)
            rec = res[0]
            output = rec.command_template_code
            
            if output == expected:
                results["CORRECT"] += 1
                status = "PASS"
            else:
                results["INCORRECT"] += 1
                status = f"FAIL (Expected {expected}, Got {output})"
            
            if name not in breakdown:
                breakdown[name] = {"PASS": 0, "FAIL": 0}
            
            if status == "PASS":
                breakdown[name]["PASS"] += 1
            else:
                breakdown[name]["FAIL"] += 1
                
        except Exception as e:
            results["ERROR"] += 1
            if name not in breakdown:
                breakdown[name] = {"PASS": 0, "FAIL": 0, "ERROR": 0}
            breakdown[name].setdefault("ERROR", 0)
            breakdown[name]["ERROR"] += 1

    print("\n==================================================")
    print("                HASIL FUZZ TESTING                 ")
    print("==================================================")
    for name, stats in breakdown.items():
        total = sum(stats.values())
        print(f"[{name.ljust(20)}] -> Total: {total} | Pass: {stats.get('PASS',0)} | Fail: {stats.get('FAIL',0)} | Error: {stats.get('ERROR',0)}")
    
    print("\n--------------------------------------------------")
    print(f"TOTAL UJI COBA  : {len(test_cases)}")
    print(f"TOTAL CORRECT   : {results['CORRECT']}")
    print(f"TOTAL INCORRECT : {results['INCORRECT']}")
    print(f"TOTAL ERROR     : {results['ERROR']}")
    
    accuracy = (results['CORRECT'] / len(test_cases)) * 100
    print(f"AKURASI SISTEM  : {accuracy:.2f}%")

if __name__ == "__main__":
    asyncio.run(run_fuzz_tests())
