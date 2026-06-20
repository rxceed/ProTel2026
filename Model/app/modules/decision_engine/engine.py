from app.modules.decision_engine.schemas import (
    EvaluateRequest,
    RecommendationOutput,
    RecommendationType,
    ConfidenceLevel,
    SubBlockInput,
    DssAction,
)
from app.modules.decision_engine.scorer import score_and_rank
from datetime import datetime
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------------------
# Konfigurasi Agronomi & Operasional
# ---------------------------------------------------------------------------
NIGHT_BLOCK_START_HOUR = 17  # 17:00 (5 Sore)
NIGHT_BLOCK_END_HOUR = 5     # 05:00 (5 Pagi)
DRAIN_TOLERANCE_CM = 5.0     # Batas maklum kelebihan air sebelum DRAIN (Histeresis)

async def evaluate_field(request: EvaluateRequest) -> list[RecommendationOutput]:
    """
    Rule-based decision engine untuk Smart AWD.
    Evaluasi setiap sub-block independen, kemudian rank secara global per field.
    """
    raw_recommendations: list[RecommendationOutput] = []

    for sub_block in request.sub_blocks:
        rec = _evaluate_sub_block(sub_block, request)
        raw_recommendations.append(rec)

    # Rank semua rekomendasi per field
    ranked = score_and_rank(raw_recommendations)
    return ranked


def _evaluate_sub_block(
    sub_block: SubBlockInput,
    request: EvaluateRequest,
) -> RecommendationOutput:
    """Evaluasi satu sub-block dan kembalikan rekomendasi mentah."""

    rule = sub_block.rule_profile

    # ── 0.5 Cek Snooze (Jeda Alarm Fisik) ────────────────────────────────────
    for flag in getattr(sub_block, 'management_flags', []):
        if flag.event_type == 'snooze_dss':
            return _build_recommendation(
                sub_block=sub_block,
                rec_type=RecommendationType.OBSERVE,
                template_code="SNOOZE_DSS",
                command_text="Sistem dijeda sementara oleh pengguna (Snooze).",
                reason="Pemeliharaan fisik atau perbaikan pematang sedang berlangsung.",
                confidence=ConfidenceLevel.HIGH,
                priority_score=0.0,
            )

    # ── 1. Cek weather warnings yang override DSS ────────────────────────────
    for warning in request.active_warnings:
        if warning.dss_action == DssAction.DELAY_IRRIGATION:
            return _build_recommendation(
                sub_block=sub_block,
                rec_type=RecommendationType.OBSERVE,
                template_code="SKIP_RAINFALL_WARNING",
                command_text="Tunda irigasi — ada peringatan cuaca aktif.",
                reason=f"Peringatan cuaca aktif: {warning.warning_type} ({warning.warning_level}). DSS menunda rekomendasi irigasi.",
                confidence=ConfidenceLevel.HIGH,
                priority_score=0.1,
            )
        if warning.dss_action == DssAction.SKIP_CYCLE:
            return _build_recommendation(
                sub_block=sub_block,
                rec_type=RecommendationType.SKIP_AWD_EVENT,
                template_code="SKIP_WARNING_CRITICAL",
                command_text="Lewati siklus AWD — peringatan kritis aktif.",
                reason=f"Peringatan cuaca kritis: {warning.warning_type}. Skip decision cycle.",
                confidence=ConfidenceLevel.HIGH,
                priority_score=0.05,
            )

    # ── 2. Jika tidak ada rule profile → observe saja ───────────────────────
    if rule is None:
        return _build_recommendation(
            sub_block=sub_block,
            rec_type=RecommendationType.OBSERVE,
            template_code="NO_RULE_PROFILE",
            command_text="Pantau kondisi sawah — tidak ada rule profile aktif.",
            reason="Tidak ada rule profile yang dikonfigurasi untuk bucket/fase ini.",
            confidence=ConfidenceLevel.LOW,
            priority_score=0.1,
        )

    # ── 3. Cek data tersedia ────────────────────────────────────────────────
    wl = sub_block.state.water_level_cm
    if wl is None or sub_block.state.state_source.value == "no_data":
        return _build_recommendation(
            sub_block=sub_block,
            rec_type=RecommendationType.OBSERVE,
            template_code="NO_DATA",
            command_text="Periksa sensor — tidak ada data level air.",
            reason="Tidak ada data level air yang tersedia. Periksa koneksi sensor.",
            confidence=ConfidenceLevel.LOW,
            priority_score=0.2,
        )

    # ── 4. Rain Event Detection — keputusan berbeda per kondisi air ──────────
    weather = request.weather
    rain_events = getattr(weather, 'rain_events', [])

    upcoming_event = None
    if rain_events:
        upcoming_event = sorted(rain_events, key=lambda x: x.hours_until_rain)[0]

    if upcoming_event and wl is not None:
        is_heavy     = upcoming_event.peak_intensity_mm >= 8.0
        is_sustained = upcoming_event.duration_hours >= 6
        is_imminent  = upcoming_event.hours_until_rain < 3
        total_mm     = upcoming_event.total_mm

        is_critical_dry = rule.drought_alert_cm is not None and wl <= rule.drought_alert_cm
        is_dry = wl <= rule.awd_lower_threshold_cm
        is_high = wl >= rule.awd_upper_target_cm
        is_flooded = wl > (rule.awd_upper_target_cm + 2.0)

        # 1. Hampir Banjir
        if is_flooded:
            if is_heavy:
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.DRAIN,
                    template_code="DRAIN_CRITICAL_RAIN",
                    command_text=f"🚨 KRITIS: Buka drainase Kotak {sub_block.code or sub_block.id[:8]} — genangan kritis ({wl:.1f} cm) & hujan lebat datang dalam {upcoming_event.hours_until_rain:.0f} jam.",
                    reason=f"Level air sangat tinggi dan hujan {upcoming_event.peak_intensity_mm:.0f}mm/3jam segera tiba.",
                    confidence=ConfidenceLevel.HIGH, priority_score=1.0,
                )

        # 2. Tinggi
        elif is_high:
            if is_heavy:
                urgency = "URGENT" if is_imminent else "SEGERA"
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.DRAIN,
                    template_code=f"DRAIN_{urgency}_RAIN",
                    command_text=f"Buka drainase Kotak {sub_block.code or sub_block.id[:8]} — hujan lebat diprediksi {upcoming_event.starts_at[11:16]} WIB.",
                    reason=f"Level air {wl:.1f} cm mendekati batas atas & hujan lebat diprediksi.",
                    confidence=ConfidenceLevel.HIGH, priority_score=0.9,
                )
            elif not is_imminent or is_sustained:
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.DRAIN,
                    template_code="DRAIN_PREPARE_RAIN",
                    command_text=f"Buka drainase Kotak {sub_block.code or sub_block.id[:8]} sebagai persiapan hujan.",
                    reason=f"Hujan berkelanjutan/segera tiba dan level air {wl:.1f} cm sudah tinggi.",
                    confidence=ConfidenceLevel.MEDIUM, priority_score=0.7,
                )

        # 3. Kritis Kering
        elif is_critical_dry:
            pass # Fall through to IRRIGATE_CRITICAL in step 5 (not vetoed)

        # 4. Kering
        elif is_dry:
            if is_imminent and is_heavy:
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.OBSERVE,
                    template_code="HOLD_RAIN_COMING",
                    command_text=f"Tunda irigasi — hujan lebat akan tiba {upcoming_event.starts_at[11:16]} WIB.",
                    reason="Hujan lebat diprediksi segera membasahi lahan yang kering.",
                    confidence=ConfidenceLevel.HIGH, priority_score=0.2,
                )
            elif not is_imminent and not is_sustained and not is_heavy:
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.IRRIGATE,
                    template_code="IRRIGATE_BEFORE_RAIN",
                    command_text=f"Segera irigasi Kotak {sub_block.code or sub_block.id[:8]} sebelum hujan tiba.",
                    reason=f"Lahan kering ({wl:.1f} cm) dan hujan masih {upcoming_event.hours_until_rain:.0f} jam lagi.",
                    confidence=ConfidenceLevel.HIGH, priority_score=0.8,
                )
            elif is_sustained:
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.OBSERVE,
                    template_code="HOLD_SUSTAINED_RAIN",
                    command_text=f"Tunda irigasi — hujan berkelanjutan diprediksi ({upcoming_event.duration_hours} jam).",
                    reason="Walau kering, hujan panjang akan mengisi lahan.",
                    confidence=ConfidenceLevel.HIGH, priority_score=0.2,
                )

        # 5. Normal
        else:
            tz = ZoneInfo("Asia/Jakarta")
            now_hour = datetime.now(tz).hour
            is_afternoon = 13 <= now_hour < 17

            if is_afternoon and is_heavy:
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.DRAIN,
                    template_code="DRAIN_PREPARE_RAIN",
                    command_text=f"Prediksi BMKG: Hujan lebat nanti malam. Segera buka pembuangan (DRAIN) untuk mengosongkan sawah sebagai ruang tampung.",
                    reason=f"Kuras antisipasi: Hujan {upcoming_event.peak_intensity_mm:.0f}mm/3jam akan datang di malam hari.",
                    confidence=ConfidenceLevel.HIGH, priority_score=0.8,
                )
            elif is_imminent or is_heavy or is_sustained or total_mm >= 2.0:
                return _build_recommendation(
                    sub_block=sub_block, rec_type=RecommendationType.OBSERVE,
                    template_code="HOLD_RAIN_FORECAST",
                    command_text=f"Tunda irigasi — hujan {upcoming_event.intensity_label} diprediksi {upcoming_event.starts_at[11:16]} WIB.",
                    reason=f"Rain event terdeteksi: {upcoming_event.total_mm:.1f}mm total, durasi {upcoming_event.duration_hours} jam.",
                    confidence=ConfidenceLevel.HIGH, priority_score=0.15,
                )

    # ── 5. Evaluasi level air vs threshold ──────────────────────────────────

    # Cek jam operasional malam (WIB)
    tz = ZoneInfo("Asia/Jakarta")
    now_hour = datetime.now(tz).hour
    is_night = now_hour >= NIGHT_BLOCK_START_HOUR or now_hour < NIGHT_BLOCK_END_HOUR

    # Level kritis — drought alert (Abaikan jam malam karena darurat)
    if rule.drought_alert_cm is not None and wl <= rule.drought_alert_cm:
        if getattr(request.field_context, 'is_source_depleted', False):
            return _build_recommendation(
                sub_block=sub_block,
                rec_type=RecommendationType.OBSERVE,
                template_code="DROUGHT_OVERRIDE",
                command_text="Air sawah kritis. (IRIGASI DIBATALKAN: Petani melaporkan sumber sungai kering total).",
                reason="Sistem membatalkan perintah irigasi darurat karena sumber air utama dilaporkan kering total.",
                confidence=ConfidenceLevel.HIGH,
                priority_score=0.2,
            )
        return _build_recommendation(
            sub_block=sub_block,
            rec_type=RecommendationType.IRRIGATE,
            template_code="IRRIGATE_CRITICAL",
            command_text=f"🚨 SEGERA irigasi — level air kritis ({wl:.1f} cm).",
            reason=f"Level air {wl:.1f} cm melewati batas kritis {rule.drought_alert_cm:.1f} cm. Irigasi mendesak.",
            confidence=ConfidenceLevel.HIGH,
            priority_score=_calc_priority(wl, rule.awd_lower_threshold_cm, boost=2.0),
        )

    # Di bawah threshold AWD → irigasi (Terkena blokir jam malam)
    if wl <= rule.awd_lower_threshold_cm:
        if getattr(request.field_context, 'is_source_depleted', False):
            return _build_recommendation(
                sub_block=sub_block,
                rec_type=RecommendationType.OBSERVE,
                template_code="DROUGHT_OVERRIDE",
                command_text="Air sawah di bawah batas. (IRIGASI DIBATALKAN: Sumber pusat kering).",
                reason="Sistem membatalkan perintah irigasi karena sumber air utama dilaporkan kering total.",
                confidence=ConfidenceLevel.HIGH,
                priority_score=0.2,
            )
        if is_night:
            return _build_recommendation(
                sub_block=sub_block,
                rec_type=RecommendationType.OBSERVE,
                template_code="DELAY_NIGHT_IRRIGATION",
                command_text="Tunda pengisian air — hari sudah gelap.",
                reason=f"Peringatan Jam Malam: Tunda pengisian air hingga besok pagi untuk mencegah banjir karena sawah ditinggal tidur.",
                confidence=ConfidenceLevel.HIGH,
                priority_score=0.2,
            )
        else:
            return _build_recommendation(
                sub_block=sub_block,
                rec_type=RecommendationType.IRRIGATE,
                template_code="IRRIGATE_THRESHOLD",
                command_text=f"Segera irigasi Kotak {sub_block.code or sub_block.id[:8]} — level air {wl:.1f} cm.",
                reason=f"Level air {wl:.1f} cm melewati threshold irigasi {rule.awd_lower_threshold_cm:.1f} cm.",
                confidence=ConfidenceLevel.HIGH,
                priority_score=_calc_priority(wl, rule.awd_lower_threshold_cm, boost=1.0),
            )

    # Di atas target → drain (Dengan Toleransi)
    if wl >= rule.awd_upper_target_cm + DRAIN_TOLERANCE_CM:
        return _build_recommendation(
            sub_block=sub_block,
            rec_type=RecommendationType.DRAIN,
            template_code="DRAIN_EXCESS",
            command_text=f"Kurangi air Kotak {sub_block.code or sub_block.id[:8]} — genangan {wl:.1f} cm melampaui batas toleransi.",
            reason=f"Level air {wl:.1f} cm melebihi target maksimum ({rule.awd_upper_target_cm:.1f} cm) + toleransi ({DRAIN_TOLERANCE_CM} cm).",
            confidence=ConfidenceLevel.MEDIUM,
            priority_score=0.5,
        )

    # Di antara threshold → maintain / AWD dry period
    return _build_recommendation(
        sub_block=sub_block,
        rec_type=RecommendationType.MAINTAIN_DRY,
        template_code="MAINTAIN_AWD_DRY",
        command_text=f"Target air ideal tercapai ({wl:.1f} cm). Pastikan seluruh pematang tertutup rapat.",
        reason=f"Level air {wl:.1f} cm dalam rentang AWD aman ({rule.awd_lower_threshold_cm:.1f} – {rule.awd_upper_target_cm:.1f} + {DRAIN_TOLERANCE_CM} cm).",
        confidence=ConfidenceLevel.HIGH,
        priority_score=0.3,
    )


def _calc_priority(current_cm: float, threshold_cm: float, boost: float = 1.0) -> float:
    """Hitung priority score berdasarkan deficit dari threshold. Makin jauh makin tinggi."""
    deficit = abs(current_cm - threshold_cm)
    # Normalisasi: 0–30 cm deficit → 0.5–1.0 score
    score = min(0.5 + (deficit / 30.0) * 0.5, 1.0)
    return score * boost


def _build_recommendation(
    sub_block: SubBlockInput,
    rec_type: RecommendationType,
    template_code: str,
    command_text: str,
    reason: str,
    confidence: ConfidenceLevel,
    priority_score: float,
) -> RecommendationOutput:
    """Helper: buat RecommendationOutput dengan nilai default."""
    return RecommendationOutput(
        sub_block_id=sub_block.id,
        recommendation_type=rec_type,
        priority_rank=0,              # akan diisi oleh scorer
        priority_score=priority_score,
        command_template_code=template_code,
        command_text=command_text,
        reason_summary=reason,
        confidence_level=confidence,
    )
