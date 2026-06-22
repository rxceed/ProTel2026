import asyncio
import sys
from datetime import datetime
from unittest.mock import patch, MagicMock
import json

from app.modules.decision_engine.schemas import (
    EvaluateRequest, FieldContext, SubBlockInput, SubBlockState,
    StateSource, RuleProfile, WeatherContext, RainEvent, ManagementFlag, RecommendationType
)
from app.modules.decision_engine.engine import evaluate_field

# Default Rule Profile
base_rule = RuleProfile(
    id="rule_1",
    awd_lower_threshold_cm=-5.0,
    awd_upper_target_cm=5.0,
    drought_alert_cm=-15.0
)

def build_request(wl, is_night, is_afternoon, weather_type="clear", snooze=False, drought=False):
    # Mock time
    mock_tz = MagicMock()
    mock_tz.hour = 20 if is_night else (15 if is_afternoon else 10)
    
    # Weather
    weather = WeatherContext(is_stale=False)
    if weather_type == "imminent_heavy":
        weather.rain_events = [RainEvent(
            starts_at="2026-06-20T11:00:00Z", ends_at="2026-06-20T13:00:00Z",
            hours_until_rain=1, duration_hours=2, total_mm=20.0, peak_intensity_mm=10.0, intensity_label="Lebat"
        )]
    elif weather_type == "sustained":
        weather.rain_events = [RainEvent(
            starts_at="2026-06-20T11:00:00Z", ends_at="2026-06-20T21:00:00Z",
            hours_until_rain=2, duration_hours=10, total_mm=50.0, peak_intensity_mm=5.0, intensity_label="Sedang"
        )]
    elif weather_type == "heavy_night":
        weather.rain_events = [RainEvent(
            starts_at="2026-06-20T22:00:00Z", ends_at="2026-06-21T01:00:00Z",
            hours_until_rain=7, duration_hours=3, total_mm=30.0, peak_intensity_mm=10.0, intensity_label="Lebat"
        )]
    
    flags = [ManagementFlag(event_type="snooze_dss", expires_at="")] if snooze else []
    
    sub_block = SubBlockInput(
        id="block_A",
        code="A",
        state=SubBlockState(water_level_cm=wl, state_source=StateSource.OBSERVED),
        rule_profile=base_rule,
        management_flags=flags
    )
    
    req = EvaluateRequest(
        job_id="test",
        field_id="field_1",
        field_context=FieldContext(is_source_depleted=drought),
        sub_blocks=[sub_block],
        weather=weather
    )
    
    return req, mock_tz

async def run_tests():
    scenarios = [
        # (Name, WL, is_night, is_afternoon, weather_type, snooze, drought, EXPECTED_REC)
        ("Kering Normal Siang", -10, False, False, "clear", False, False, RecommendationType.IRRIGATE),
        ("Kering Normal Malam (Night Block)", -10, True, False, "clear", False, False, RecommendationType.OBSERVE),
        ("Kritis Kering Malam (Night Block Bypassed)", -20, True, False, "clear", False, False, RecommendationType.IRRIGATE),
        
        ("Banjir Kritis", 15, False, False, "clear", False, False, RecommendationType.DRAIN),
        ("Banjir Toleransi (Histeresis +8cm)", 8, False, False, "clear", False, False, RecommendationType.MAINTAIN_DRY),
        
        ("Hujan Lebat Segera (Hold Irrigate)", -10, False, False, "imminent_heavy", False, False, RecommendationType.OBSERVE),
        ("Hujan Badai Nanti Malam (Pre-emptive Drain Sore)", 4, False, True, "heavy_night", False, False, RecommendationType.DRAIN),
        
        ("Kering tapi Sumber Habis (Drought Override)", -10, False, False, "clear", False, True, RecommendationType.OBSERVE),
        ("Kritis Kering tapi Sumber Habis (Drought Override)", -20, False, False, "clear", False, True, RecommendationType.OBSERVE),
        
        ("Banjir tapi Snooze Pematang (Snooze Override)", 15, False, False, "clear", True, False, RecommendationType.OBSERVE),
    ]

    print("="*60)
    print("HOLISTIC BLACK BOX TESTING: SMART AWD DSS")
    print("="*60)
    
    passed = 0
    total = len(scenarios)
    
    for name, wl, is_night, is_afternoon, weather, snooze, drought, expected in scenarios:
        req, mock_tz = build_request(wl, is_night, is_afternoon, weather, snooze, drought)
        
        with patch('app.modules.decision_engine.engine.datetime') as mock_datetime:
            mock_datetime.now.return_value = mock_tz
            recs = await evaluate_field(req)
            
        actual = recs[0].recommendation_type
        status = "PASS" if actual == expected else "FAIL"
        if actual == expected:
            passed += 1
            
        print(f"[{status}] {name}")
        print(f"   Input : WL={wl:^3}cm | Night={str(is_night):<5} | Afternoon={str(is_afternoon):<5} | Weather={weather:<14} | Snooze={str(snooze):<5} | Drought={str(drought):<5}")
        print(f"   Output: {actual.value.upper():<15} (Expected: {expected.value.upper()})")
        print(f"   Reason: {recs[0].reason_summary}")
        print("-" * 60)
        
    print(f"\nTEST SUMMARY: {passed}/{total} Scenarios Passed")
    if passed == total:
        print("ALL TESTS PASSED: The Decision Engine is extremely robust against edge cases!")

if __name__ == "__main__":
    asyncio.run(run_tests())
