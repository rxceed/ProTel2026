import asyncio
import itertools
from datetime import datetime
from unittest.mock import patch, MagicMock

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

def build_request(wl, hour, weather_type, snooze, drought):
    mock_tz = MagicMock()
    mock_tz.hour = hour
    
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

async def run_massive_tests():
    water_levels = [-25, -20, -10, -5, 0, 4, 8, 12, 18, 25]  # 10 values
    hours = [2, 8, 15, 22]  # 4 values (Night, Morning, Afternoon, Night)
    weathers = ["clear", "imminent_heavy", "sustained", "heavy_night"]  # 4 values
    snoozes = [True, False]  # 2 values
    droughts = [True, False]  # 2 values
    
    combinations = list(itertools.product(water_levels, hours, weathers, snoozes, droughts))
    total_cases = len(combinations)
    
    print("=" * 60)
    print(f"MASSIVE COMBINATORIAL TESTING: {total_cases} SCENARIOS")
    print("=" * 60)
    
    stats = {
        RecommendationType.IRRIGATE: 0,
        RecommendationType.DRAIN: 0,
        RecommendationType.MAINTAIN_DRY: 0,
        RecommendationType.OBSERVE: 0,
        RecommendationType.SKIP_AWD_EVENT: 0,
    }
    
    failures = 0
    
    for wl, hour, weather, snooze, drought in combinations:
        req, mock_tz = build_request(wl, hour, weather, snooze, drought)
        
        with patch('app.modules.decision_engine.engine.datetime') as mock_datetime:
            mock_datetime.now.return_value = mock_tz
            recs = await evaluate_field(req)
            
        actual = recs[0].recommendation_type
        reason = recs[0].reason_summary
        template = recs[0].command_template_code
        stats[actual] += 1
        
        # ── VERIFY INVARIANTS (The "Rules of the Universe") ──
        try:
            # 1. Snooze Override is Absolute
            if snooze:
                assert template == "SNOOZE_DSS", f"Snooze failed. Got {template}"
                
            # 2. Drought Override prevents all normal irrigation
            if drought and not snooze:
                assert actual != RecommendationType.IRRIGATE, "Drought override failed to stop IRRIGATE!"
                
            # 3. Night Block prevents normal irrigation
            is_night = hour >= 17 or hour < 5
            if is_night and not snooze and not drought and wl > -15.0:
                assert actual != RecommendationType.IRRIGATE, "Night block failed to stop IRRIGATE!"
                
        except AssertionError as e:
            failures += 1
            print(f"❌ INVARIANT FAILED: {str(e)}")
            print(f"   Context: WL={wl}, Hour={hour}, Weather={weather}, Snooze={snooze}, Drought={drought}")
            
    print(f"\nVerifikasi Selesai!")
    print(f"Total Skenario: {total_cases}")
    print(f"Pelanggaran Aturan Logika (Failures): {failures}")
    print("\n--- Distribusi Output Keputusan ---")
    for k, v in stats.items():
        print(f" - {k.value.upper():<15} : {v} kasus ({v/total_cases*100:.1f}%)")

if __name__ == "__main__":
    asyncio.run(run_massive_tests())
