import 'package:flutter/material.dart';

/// Legacy names retained for compatibility. Prefer [MintObsidian] / [TacticalColors] for new UI.
abstract final class AppColors {
  /// Deep slate stack (replaces gray “teal” naming).
  static const Color tealTop = Color(0xFF0F172A);
  static const Color tealDeep = Color(0xFF020817);
  static const Color tealDark = Color(0xFF010510);
  /// Primary filled actions — neon green (smart-home “on” accent).
  static const Color purple = Color(0xFF22C55E);
  static const Color purpleLight = Color(0xFF38BDF8);
  static const Color white = Color(0xFFFFFFFF);
  /// Card / field fill on dark glass screens.
  static const Color offWhite = Color(0xFF131B2E);
  /// Primary text on light surfaces (dialogs, legacy sheets).
  static const Color textDark = Color(0xFF0F172A);
  static const Color textMuted = Color(0xFF64748B);
  static const Color line = Color(0xFF334155);

  /// Vault atmosphere: obsidian with a cool cyan lift (matches tactical reference).
  static const LinearGradient tealHeaderGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Color(0xFF0C1929),
      Color(0xFF020817),
      Color(0xFF082F49),
    ],
    stops: [0.0, 0.42, 1.0],
  );
}

/// Command Center / tactical UI tokens (obsidian corridor, ocean borders, alert accents).
abstract final class TacticalColors {
  static const Color obsidian = Color(0xFF020817);
  static const Color obsidianElevated = Color(0xFF0A1226);
  static const Color slideOceanBlue = Color(0xFF38BDF8);
  static const Color alertRed = Color(0xFFE11D48);
  static const Color neonCyan = Color(0xFF22D3EE);
  static const Color amberSignal = Color(0xFFF59E0B);
  static const Color borderSubtle = Color(0x1AFFFFFF);
  static const Color sosCrimson = Color(0xFF450A0A);
  static const Color endShiftBorder = Color(0xFF6B7280);
}

/// Smart-home / tactical dashboard: obsidian canvas, neon green “live” state, electric blue secondaries.
abstract final class MintObsidian {
  static const Color canvas = Color(0xFF020817);
  static const Color surface = Color(0xFF0A1226);
  static const Color surfaceElevated = Color(0xFF131B2E);
  static const Color mintSoft = Color(0xFF86EFAC);
  static const Color mint = Color(0xFF4ADE80);
  static const Color mintDeep = Color(0xFF16A34A);
  static const Color ocean = Color(0xFF38BDF8);
  static const Color oceanDeep = Color(0xFF0EA5E9);
  static const Color textPrimary = Color(0xFFF8FAFC);
  static const Color textSecondary = Color(0xFF94A3B8);
  static const Color textOnMint = Color(0xFF020817);

  /// Typography on the warm hero / “priority” gradient (white, not dark).
  static const Color heroForeground = Color(0xFFFFFFFF);
  static const Color heroGlow = Color(0x66FF416C);

  /// Crimson → orange “weather tile” style hero (high-visibility metric).
  static const LinearGradient heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFFFF416C),
      Color(0xFFFF4B2B),
      Color(0xFFF97316),
    ],
    stops: [0.0, 0.48, 1.0],
  );

  static const LinearGradient activeTileGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF4ADE80), Color(0xFF22C55E)],
  );

  static List<BoxShadow> tileShadow(bool active) => [
        BoxShadow(
          color: active ? mint.withOpacity(0.38) : Colors.black.withOpacity(0.55),
          blurRadius: active ? 26 : 20,
          offset: const Offset(0, 10),
        ),
      ];
}
