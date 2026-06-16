import asyncio
import sys
import os

# Menambahkan parent path ke sys.path agar bisa melakukan import dari app.*
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

async def test_scenarios():
    print("=== DSS ENGINE SIMULATION TESTS ===")
    
    # 1. Kasus Banjir -> Harus mengeluarkan DRAIN
    req1 = EvaluateRequest(
        job_id="test-job-1",
        field_id="field-1",
        cycle_mode="normal",
        field_context=FieldContext(water_source_type="irrigated", operator_count=1),
        weather=WeatherContext(precipitation_mm=0.0, temperature_c=30.0, humidity_pct=70.0, is_stale=False),
        active_warnings=[],
        sub_blocks=[
            SubBlockInput(
                id="sb-1",
                code="A1",
                state=SubBlockState(water_level_cm=8.0, state_source="observed", freshness_status="fresh", interpolation_confidence=1.0),
                crop_cycle=None,
                rule_profile=RuleProfile(id="rule-1", awd_lower_threshold_cm=2.0, awd_upper_target_cm=5.0, rain_delay_mm=10.0, priority_weight=1.0, rainfed_modifier_pct=0.0, target_confidence="high"),
                management_flags=[],
                flow_paths=[]
            )
        ]
    )

    # 2. Kasus Kritis Kering -> Harus mengeluarkan IRRIGATE_CRITICAL
    req2 = EvaluateRequest(
        job_id="test-job-2",
        field_id="field-1",
        cycle_mode="normal",
        field_context=FieldContext(water_source_type="irrigated", operator_count=1),
        weather=WeatherContext(precipitation_mm=0.0, temperature_c=30.0, humidity_pct=70.0, is_stale=False),
        active_warnings=[],
        sub_blocks=[
            SubBlockInput(
                id="sb-2",
                code="A2",
                state=SubBlockState(water_level_cm=-1.0, state_source="observed", freshness_status="fresh", interpolation_confidence=1.0),
                crop_cycle=None,
                rule_profile=RuleProfile(id="rule-1", awd_lower_threshold_cm=2.0, awd_upper_target_cm=5.0, drought_alert_cm=0.0, rain_delay_mm=10.0, priority_weight=1.0, rainfed_modifier_pct=0.0, target_confidence="high"),
                management_flags=[],
                flow_paths=[]
            )
        ]
    )

    # 3. Kasus Normal AWD -> Harus mengeluarkan MAINTAIN
    req3 = EvaluateRequest(
        job_id="test-job-3",
        field_id="field-1",
        cycle_mode="normal",
        field_context=FieldContext(water_source_type="irrigated", operator_count=1),
        weather=WeatherContext(precipitation_mm=0.0, temperature_c=30.0, humidity_pct=70.0, is_stale=False),
        active_warnings=[],
        sub_blocks=[
            SubBlockInput(
                id="sb-3",
                code="A3",
                state=SubBlockState(water_level_cm=3.0, state_source="observed", freshness_status="fresh", interpolation_confidence=1.0),
                crop_cycle=None,
                rule_profile=RuleProfile(id="rule-1", awd_lower_threshold_cm=2.0, awd_upper_target_cm=5.0, rain_delay_mm=10.0, priority_weight=1.0, rainfed_modifier_pct=0.0, target_confidence="high"),
                management_flags=[],
                flow_paths=[]
            )
        ]
    )

    # 4. Kasus Hujan Lebat (Precipitation tinggi) -> Harus OBSERVE (Tunda Irigasi)
    req4 = EvaluateRequest(
        job_id="test-job-4",
        field_id="field-1",
        cycle_mode="normal",
        field_context=FieldContext(water_source_type="irrigated", operator_count=1),
        weather=WeatherContext(precipitation_mm=25.0, temperature_c=30.0, humidity_pct=70.0, is_stale=False), # Hujan 25mm, batas 10mm
        active_warnings=[],
        sub_blocks=[
            SubBlockInput(
                id="sb-4",
                code="A4",
                state=SubBlockState(water_level_cm=1.0, state_source="observed", freshness_status="fresh", interpolation_confidence=1.0),
                crop_cycle=None,
                rule_profile=RuleProfile(id="rule-1", awd_lower_threshold_cm=2.0, awd_upper_target_cm=5.0, rain_delay_mm=10.0, priority_weight=1.0, rainfed_modifier_pct=0.0, target_confidence="high"),
                management_flags=[],
                flow_paths=[]
            )
        ]
    )

    # 5. Kasus BMKG Warning (Delay Irrigation) -> Harus OBSERVE (Tunda Irigasi)
    req5 = EvaluateRequest(
        job_id="test-job-5",
        field_id="field-1",
        cycle_mode="normal",
        field_context=FieldContext(water_source_type="irrigated", operator_count=1),
        weather=WeatherContext(precipitation_mm=0.0, temperature_c=30.0, humidity_pct=70.0, is_stale=False),
        active_warnings=[WeatherWarning(warning_type="Storm", warning_level="Red", dss_action=DssAction.DELAY_IRRIGATION, warning_text="Badai")],
        sub_blocks=[
            SubBlockInput(
                id="sb-5",
                code="A5",
                state=SubBlockState(water_level_cm=1.0, state_source="observed", freshness_status="fresh", interpolation_confidence=1.0),
                crop_cycle=None,
                rule_profile=RuleProfile(id="rule-1", awd_lower_threshold_cm=2.0, awd_upper_target_cm=5.0, rain_delay_mm=10.0, priority_weight=1.0, rainfed_modifier_pct=0.0, target_confidence="high"),
                management_flags=[],
                flow_paths=[]
            )
        ]
    )

    # 6. Kasus Sensor Mati Total -> Harus OBSERVE (NO DATA)
    req6 = EvaluateRequest(
        job_id="test-job-6",
        field_id="field-1",
        cycle_mode="normal",
        field_context=FieldContext(water_source_type="irrigated", operator_count=1),
        weather=WeatherContext(precipitation_mm=0.0, temperature_c=30.0, humidity_pct=70.0, is_stale=False),
        active_warnings=[],
        sub_blocks=[
            SubBlockInput(
                id="sb-6",
                code="A6",
                state=SubBlockState(water_level_cm=None, state_source="no_data", freshness_status="no_data", interpolation_confidence=None),
                crop_cycle=None,
                rule_profile=RuleProfile(id="rule-1", awd_lower_threshold_cm=2.0, awd_upper_target_cm=5.0, rain_delay_mm=10.0, priority_weight=1.0, rainfed_modifier_pct=0.0, target_confidence="high"),
                management_flags=[],
                flow_paths=[]
            )
        ]
    )

    requests = [
        ("Skenario 1: Banjir (Air > Target)", req1),
        ("Skenario 2: Kekeringan Kritis (Air < Drought Alert)", req2),
        ("Skenario 3: Normal (Air sesuai rentang AWD)", req3),
        ("Skenario 4: Hujan Lebat (Prakiraan > Threshold)", req4),
        ("Skenario 5: Peringatan BMKG Aktif (Badai)", req5),
        ("Skenario 6: Sensor Mati / No Data", req6)
    ]

    correct_count = 0
    total = len(requests)

    for name, req in requests:
        print(f"\nMenjalankan: {name}")
        res = await evaluate_field(req)
        rec = res[0]
        print(f"Hasil: {rec.command_template_code} | Priority Score: {rec.priority_score} | Rank: {rec.priority_rank}")
        print(f"Pesan: {rec.command_text}")
        
        # Simple Validation
        if "Banjir" in name and "DRAIN" in rec.command_template_code:
            correct_count += 1
        elif "Kekeringan" in name and "IRRIGATE_CRITICAL" in rec.command_template_code:
            correct_count += 1
        elif "Normal" in name and "MAINTAIN" in rec.command_template_code:
            correct_count += 1
        elif "Hujan" in name and "SKIP" in rec.command_template_code:
            correct_count += 1
        elif "BMKG" in name and "SKIP" in rec.command_template_code:
            correct_count += 1
        elif "Sensor Mati" in name and "NO_DATA" in rec.command_template_code:
            correct_count += 1

    print("\n==============================")
    print(f"REPORT: {correct_count} dari {total} simulasi menghasilkan Output CORRECT.")
    if correct_count == total:
        print("DSS ENGINE BEKERJA 100% SESUAI ATURAN (NO ERROR).")

if __name__ == "__main__":
    asyncio.run(test_scenarios())
