"""AI Video Director Engine (`services/ai_director.py` — Phase 3).

Analyzes subtitle cues (Algerian Darija mixed with French/English, MSA, French,
or English) and enriches each cue with a `VisualCuePlan`:
    * `emphasis_type`: "normal" | "pop" | "shake_red" | "bounce"
    * `emoji_or_icon`: Contextual Unicode emoji ("💸", "📱", "🚀", "📉", "🔗", ...)
    * `broll_query`: English search query for vertical Pexels stock video
    * `motion_graphic`: "none" | "stat_badge" | "cta_bio" | "cta_follow"
    * `graphic_text`: Display text inside the motion graphic card
    * `sfx_trigger`: "none" | "whoosh" | "pop" | "cash" | "error" | "click"
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, List, Sequence, Tuple

from ..config import GEMINI_MODEL, get_gemini_api_key
from ..models import (
    EmphasisType,
    EnrichedSubtitleCue,
    MotionGraphicType,
    SfxTriggerType,
    VisualCuePlan,
)

logger = logging.getLogger("hormozisub.director")

_VALID_EMPHASIS = {"normal", "pop", "shake_red", "bounce"}
_VALID_MOTION_GRAPHIC = {"none", "stat_badge", "cta_bio", "cta_follow"}
_VALID_SFX = {"none", "whoosh", "pop", "cash", "error", "click"}


class AIDirector:
    """Generates `VisualCuePlan` enrichments via Gemini 2.5 Flash or Darija semantic rules."""

    def direct_cues(
        self,
        cues: Sequence[EnrichedSubtitleCue],
    ) -> Tuple[List[EnrichedSubtitleCue], str]:
        """Enrich every cue with a `VisualCuePlan`. Returns `(enriched_cues, engine_name)`."""
        if not cues:
            return [], "none"

        gemini_key = get_gemini_api_key()
        if gemini_key:
            try:
                directed = self._direct_via_gemini(cues, gemini_key)
                if directed:
                    return directed, f"gemini-director:{GEMINI_MODEL}"
            except Exception as exc:
                logger.warning("Gemini AI Director failed (%s); falling back to Darija heuristic director.", exc)

        directed = self._direct_via_local_heuristics(cues)
        return directed, "heuristic-darija-director"

    # ------------------------------------------------------------------ #
    # Gemini 2.5 Flash AI Director Pass
    # ------------------------------------------------------------------ #
    def _direct_via_gemini(
        self,
        cues: Sequence[EnrichedSubtitleCue],
        api_key: str,
    ) -> List[EnrichedSubtitleCue]:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
        cues_input = [
            {
                "index": idx,
                "start": c.start,
                "end": c.end,
                "text": c.text,
            }
            for idx, c in enumerate(cues)
        ]

        system_prompt = (
            "You are a Principal Short-Form Video Director specializing in Alex Hormozi / Iman Gadzhi style "
            "Algerian Darija + Tech/Business reels.\n"
            "Analyze the provided subtitle cues and produce a `VisualCuePlan` for EVERY cue.\n\n"
            "FIELD SPECIFICATIONS:\n"
            "1. `emphasis_type`: MUST be one of [\"normal\", \"pop\", \"shake_red\", \"bounce\"].\n"
            "   - Use \"shake_red\" on pain points, money loss, slow websites, zero orders (e.g., \"دراهمك راهم يروحوا\", \"زيرو كوموند\", \"ثقيلة ما تفتحش\").\n"
            "   - Use \"pop\" on strong hooks, tech keywords, or CTAs.\n"
            "   - Use \"bounce\" on positive results, growth, conversions, or dynamic transitions.\n"
            "2. `emoji_or_icon`: Single expressive Unicode emoji matching the cue (e.g., \"💸\", \"📱\", \"🚀\", \"📉\", \"🔗\", \"🔥\", \"❌\", \"💰\").\n"
            "3. `broll_query`: Concise 3-to-6 word ENGLISH search query for Pexels vertical stock footage translating the visual meaning of the Darija cue "
            "(e.g., \"person frustrated with slow smartphone\", \"mobile app UI design\", \"startup developer coding\", \"counting money cash loss\").\n"
            "4. `motion_graphic`: MUST be one of [\"none\", \"stat_badge\", \"cta_bio\", \"cta_follow\"].\n"
            "   - Use \"stat_badge\" when a metric, loss, or tech KPI is mentioned (with `graphic_text` like \"0 Orders ❌\", \"CPC 📉\", \"Load Time > 5s ⚠️\").\n"
            "   - Use \"cta_bio\" when bio/link is mentioned (`graphic_text`: \"اللينك راه في البايو 🔗\").\n"
            "   - Use \"cta_follow\" on subscribe/follow cues (`graphic_text`: \"دير أبوني +\").\n"
            "5. `sfx_trigger`: MUST be one of [\"none\", \"whoosh\", \"pop\", \"cash\", \"error\", \"click\"].\n"
            "   - Pair pain points / zero orders with \"error\", money/cost with \"cash\", hooks with \"whoosh\" or \"pop\", and CTAs with \"click\".\n\n"
            "Return ONLY valid JSON: {\"plans\": [{\"index\": 0, \"emphasis_type\": \"...\", \"emoji_or_icon\": \"...\", \"broll_query\": \"...\", \"motion_graphic\": \"...\", \"graphic_text\": \"...\", \"sfx_trigger\": \"...\"}]}"
        )

        candidate_models = [GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-1.5-flash"]
        response = None
        last_err: Optional[Exception] = None
        for model_name in candidate_models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=f"Direct these subtitle cues:\n{json.dumps(cues_input, ensure_ascii=False)}",
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        response_mime_type="application/json",
                        temperature=0.25,
                    ),
                )
                if response and response.text:
                    break
            except Exception as exc:
                last_err = exc
                continue

        if not response or not response.text:
            raise last_err or ValueError("Gemini AI Director failed on all candidate models")
        raw_text = (response.text or "").strip()
        if raw_text.startswith("```"):
            raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
            raw_text = re.sub(r"\s*```$", "", raw_text)
        data = json.loads(raw_text)
        plans_list = data.get("plans") if isinstance(data, dict) else data
        if not isinstance(plans_list, list):
            raise ValueError("Gemini director did not return a 'plans' list")

        plan_by_idx = {
            int(item.get("index", i)): item
            for i, item in enumerate(plans_list)
            if isinstance(item, dict)
        }

        enriched: List[EnrichedSubtitleCue] = []
        for idx, cue in enumerate(cues):
            raw_plan = plan_by_idx.get(idx)
            if raw_plan:
                plan = self._sanitize_plan(raw_plan, cue, idx, len(cues))
            else:
                plan = self._heuristic_plan_for_cue(cue, idx, len(cues))
            enriched.append(cue.model_copy(update={"index": idx, "visual_plan": plan}, deep=True))
        return enriched

    # ------------------------------------------------------------------ #
    # Sanitizer & Local Algerian Darija Semantic Heuristic Director
    # ------------------------------------------------------------------ #
    def _sanitize_plan(
        self,
        raw: dict[str, Any],
        cue: EnrichedSubtitleCue,
        idx: int,
        total: int,
    ) -> VisualCuePlan:
        fallback = self._heuristic_plan_for_cue(cue, idx, total)
        emphasis = str(raw.get("emphasis_type", "")).strip().lower()
        if emphasis not in _VALID_EMPHASIS:
            emphasis = fallback.emphasis_type

        mg = str(raw.get("motion_graphic", "")).strip().lower()
        if mg not in _VALID_MOTION_GRAPHIC:
            mg = fallback.motion_graphic

        sfx = str(raw.get("sfx_trigger", "")).strip().lower()
        if sfx not in _VALID_SFX:
            sfx = fallback.sfx_trigger

        emoji = str(raw.get("emoji_or_icon", "")).strip() or fallback.emoji_or_icon
        broll = str(raw.get("broll_query", "")).strip() or fallback.broll_query
        g_text = str(raw.get("graphic_text", "")).strip() or fallback.graphic_text

        color_override = "#FF2A2A" if emphasis == "shake_red" else None
        return VisualCuePlan(
            emphasis_type=emphasis,  # type: ignore[arg-type]
            emoji_or_icon=emoji,
            broll_query=broll,
            motion_graphic=mg,  # type: ignore[arg-type]
            graphic_text=g_text,
            sfx_trigger=sfx,  # type: ignore[arg-type]
            highlight_color_override=color_override,
        )

    def _direct_via_local_heuristics(
        self,
        cues: Sequence[EnrichedSubtitleCue],
    ) -> List[EnrichedSubtitleCue]:
        total = len(cues)
        enriched: List[EnrichedSubtitleCue] = []
        for idx, cue in enumerate(cues):
            plan = self._heuristic_plan_for_cue(cue, idx, total)
            enriched.append(cue.model_copy(update={"index": idx, "visual_plan": plan}, deep=True))
        return enriched

    def _heuristic_plan_for_cue(
        self,
        cue: EnrichedSubtitleCue,
        idx: int,
        total: int,
    ) -> VisualCuePlan:
        t = cue.text.lower()

        # 1. CTA Bio / Link detection
        if any(k in t for k in ("بايو", "البايو", "اللينك", "الرابط", "bio", "link in bio", "lien")):
            return VisualCuePlan(
                emphasis_type="pop",
                emoji_or_icon="🔗",
                broll_query="person tapping smartphone profile link",
                motion_graphic="cta_bio",
                graphic_text="اللينك راه في البايو 🔗",
                sfx_trigger="click",
            )

        # 2. CTA Follow / Subscribe detection
        if any(k in t for k in ("أبوني", "ابوني", "فولو", "اشترك", "follow", "abonne", "subscribe")):
            return VisualCuePlan(
                emphasis_type="pop",
                emoji_or_icon="🚀",
                broll_query="social media creator gaining followers on phone",
                motion_graphic="cta_follow",
                graphic_text="دير أبوني +",
                sfx_trigger="click",
            )

        # 3. Money / Ad Spend Pain Points ("دراهمك راهم يروحوا", "خسارة", "burning")
        if any(k in t for k in ("دراهم", "يروحوا", "أموال", "خسارة", "غالي", "money", "budget", "burning", "brûler", "cost per click", "cpc")):
            return VisualCuePlan(
                emphasis_type="shake_red",
                emoji_or_icon="💸",
                broll_query="stressed entrepreneur losing money online ads",
                motion_graphic="stat_badge",
                graphic_text="High CPC 📉",
                sfx_trigger="cash",
                highlight_color_override="#FF2A2A",
            )

        # 4. Zero Orders / Low Conversion / Slow Page Pain Points
        if any(
            k in t
            for k in (
                "زيرو",
                "كوموند",
                "ما تفتحش",
                "ثقيلة",
                "بطيئة",
                "يخرج",
                "تخرج",
                "صفر",
                "zero",
                "zéro",
                "slow",
                "lente",
                "won't load",
            )
        ):
            is_orders = any(k in t for k in ("زيرو", "كوموند", "صفر", "zero", "zéro", "orders", "commandes"))
            return VisualCuePlan(
                emphasis_type="shake_red",
                emoji_or_icon="📉" if is_orders else "⚠️",
                broll_query=(
                    "ecommerce dashboard showing zero sales"
                    if is_orders
                    else "person frustrated with slow smartphone loading"
                ),
                motion_graphic="stat_badge",
                graphic_text="0 Orders ❌" if is_orders else "Slow Load ⚠️",
                sfx_trigger="error",
                highlight_color_override="#FF2A2A",
            )

        # 5. Tech / Startup / App / Landing Page / UI-UX Hooks
        if any(
            k in t
            for k in (
                "ستارتاب",
                "أبليكاسيون",
                "ابليكاسيون",
                "سيت",
                "تطبيق",
                "موقع",
                "landing",
                "page",
                "mvp",
                "ui",
                "ux",
                "conversion",
                "app",
                "startup",
            )
        ):
            return VisualCuePlan(
                emphasis_type="pop" if idx == 0 else "bounce",
                emoji_or_icon="📱" if any(w in t for w in ("أبليكاسيون", "تطبيق", "app", "ui")) else "🚀",
                broll_query="modern mobile app UI design on smartphone screen",
                motion_graphic="stat_badge" if "conversion" in t else "none",
                graphic_text="Conversion +320% 🚀" if "conversion" in t else "",
                sfx_trigger="whoosh" if idx == 0 else "pop",
            )

        # 6. Client / Audience / Customer cues ("الكليون تاعك")
        if any(k in t for k in ("كليون", "الكليون", "عميل", "العميل", "client", "customer")):
            return VisualCuePlan(
                emphasis_type="bounce",
                emoji_or_icon="🎯",
                broll_query="customer scrolling smartphone shopping online",
                motion_graphic="none",
                graphic_text="",
                sfx_trigger="pop",
            )

        # 7. Opening Hook (first cue) or Closing CTA (last cue)
        if idx == 0:
            return VisualCuePlan(
                emphasis_type="pop",
                emoji_or_icon="🔥",
                broll_query="dynamic entrepreneur speaking in studio",
                motion_graphic="none",
                graphic_text="",
                sfx_trigger="whoosh",
            )
        if idx == total - 1:
            return VisualCuePlan(
                emphasis_type="pop",
                emoji_or_icon="🔗",
                broll_query="smartphone call to action button tap",
                motion_graphic="cta_bio",
                graphic_text="اللينك راه في البايو 🔗",
                sfx_trigger="click",
            )

        # 8. Default energetic caption cue
        return VisualCuePlan(
            emphasis_type="normal",
            emoji_or_icon="⚡",
            broll_query="modern tech workspace laptop and smartphone",
            motion_graphic="none",
            graphic_text="",
            sfx_trigger="pop" if idx % 2 == 1 else "none",
        )
