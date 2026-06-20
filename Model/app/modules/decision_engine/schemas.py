from pydantic import BaseModel
from typing import Optional
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class RecommendationType(str, Enum):
    IRRIGATE           = "irrigate"
    DRAIN              = "drain"
    MAINTAIN_WET       = "maintain_wet"
    MAINTAIN_DRY       = "maintain_dry"
    OBSERVE            = "observe"
    SKIP_AWD_EVENT     = "skip_awd_event"


class ConfidenceLevel(str, Enum):
    HIGH   = "high"
    MEDIUM = "medium"
    LOW    = "low"


class StateSource(str, Enum):
    OBSERVED  = "observed"
    ESTIMATED = "estimated"
    MANUAL    = "manual"
    NO_DATA   = "no_data"


class DssAction(str, Enum):
    NONE                 = "none"
    DELAY_IRRIGATION     = "delay_irrigation"
    PRIORITIZE_DRAINAGE  = "prioritize_drainage"
    SKIP_CYCLE           = "skip_cycle"


# ---------------------------------------------------------------------------
# Input schemas
# ---------------------------------------------------------------------------

class SubBlockState(BaseModel):
    water_level_cm:          Optional[float] = None
    state_source:            StateSource = StateSource.NO_DATA
    freshness_status:        str = "no_data"
    last_observation_at:     Optional[str] = None
    interpolation_confidence:Optional[float] = None


class RuleProfile(BaseModel):
    id:                    str
    awd_lower_threshold_cm:float
    awd_upper_target_cm:   float
    drought_alert_cm:      Optional[float] = None
    priority_weight:       float = 1.0
    rain_delay_mm:         float = 10.0
    target_confidence:     str = "high"
    rainfed_modifier_pct:  float = 0.0


class CropCycle(BaseModel):
    bucket_code:       str
    phase_code:        str
    hst:               int
    variety_name:      Optional[str] = None


class ManagementFlag(BaseModel):
    event_type:        str
    flag_text:         Optional[str] = None
    expires_at:        str


class FlowPath(BaseModel):
    to_sub_block_id:   str
    from_sub_block_id: str
    flow_type:         str = "natural"


class SubBlockInput(BaseModel):
    id:                str
    code:              Optional[str] = None
    state:             SubBlockState
    crop_cycle:        Optional[CropCycle] = None
    rule_profile:      Optional[RuleProfile] = None
    management_flags:  list[ManagementFlag] = []
    flow_paths:        list[FlowPath] = []


class RainEvent(BaseModel):
    starts_at:          str
    ends_at:            str
    hours_until_rain:   float
    duration_hours:     int
    total_mm:           float
    peak_intensity_mm:  float
    intensity_label:    str

class WeatherContext(BaseModel):
    rain_events:       list[RainEvent] = []
    peak_intensity_mm: Optional[float] = None
    bmkg_category:     Optional[str] = None
    temperature_c:     Optional[float] = None
    humidity_pct:      Optional[float] = None
    is_stale:          bool = False


class WeatherWarning(BaseModel):
    warning_type:      Optional[str] = None
    warning_level:     Optional[str] = None
    dss_action:        DssAction = DssAction.NONE
    warning_text:      Optional[str] = None


class FieldContext(BaseModel):
    water_source_type: str = "irrigated"
    operator_count:    int = 1
    is_source_depleted: bool = False


class EvaluateRequest(BaseModel):
    job_id:        str
    field_id:      str
    cycle_mode:    str = "normal"
    field_context: FieldContext = FieldContext()
    sub_blocks:    list[SubBlockInput]
    weather:       WeatherContext = WeatherContext()
    active_warnings: list[WeatherWarning] = []


# ---------------------------------------------------------------------------
# Output schemas
# ---------------------------------------------------------------------------

class RecommendationOutput(BaseModel):
    sub_block_id:          str
    recommendation_type:   RecommendationType
    priority_rank:         int
    priority_score:        float
    from_sub_block_id:     Optional[str] = None
    to_sub_block_id:       Optional[str] = None
    command_template_code: str
    command_text:          str
    reason_summary:        str
    confidence_level:      ConfidenceLevel
    attention_flags_json:  Optional[dict] = None
    operator_warning_text: Optional[str] = None


class EvaluateResponse(BaseModel):
    job_id:          str
    engine_version:  str = "1.0.0"
    evaluated_at:    str
    recommendations: list[RecommendationOutput]
