import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';

/// Plus Jakarta Sans scale tuned for attendant UI (POS + dashboard hierarchy).
TextTheme _busAttendantTextTheme(ColorScheme scheme) {
  final base = ThemeData(
    useMaterial3: true,
    brightness: scheme.brightness,
    colorScheme: scheme,
  ).textTheme;
  final onSurface = scheme.onSurface;
  final onSurfaceVariant = scheme.onSurfaceVariant;

  return GoogleFonts.plusJakartaSansTextTheme(base).copyWith(
    displayLarge: GoogleFonts.plusJakartaSans(
      fontSize: 32,
      fontWeight: FontWeight.w800,
      height: 1.08,
      letterSpacing: -0.4,
      color: onSurface,
    ),
    displayMedium: GoogleFonts.plusJakartaSans(
      fontSize: 40,
      fontWeight: FontWeight.w800,
      height: 1.05,
      color: onSurface,
    ),
    displaySmall: GoogleFonts.plusJakartaSans(
      fontSize: 36,
      fontWeight: FontWeight.w800,
      height: 1.05,
      color: onSurface,
    ),
    headlineLarge: GoogleFonts.plusJakartaSans(
      fontSize: 32,
      fontWeight: FontWeight.w800,
      height: 1.12,
      color: onSurface,
    ),
    headlineMedium: GoogleFonts.plusJakartaSans(
      fontSize: 28,
      fontWeight: FontWeight.w700,
      height: 1.15,
      color: onSurface,
    ),
    headlineSmall: GoogleFonts.plusJakartaSans(
      fontSize: 24,
      fontWeight: FontWeight.w800,
      height: 1.2,
      color: onSurface,
    ),
    titleLarge: GoogleFonts.plusJakartaSans(
      fontSize: 22,
      fontWeight: FontWeight.w800,
      height: 1.2,
      color: onSurface,
    ),
    titleMedium: GoogleFonts.plusJakartaSans(
      fontSize: 16,
      fontWeight: FontWeight.w600,
      height: 1.35,
      color: onSurface,
    ),
    titleSmall: GoogleFonts.plusJakartaSans(
      fontSize: 14,
      fontWeight: FontWeight.w600,
      height: 1.3,
      color: onSurface,
    ),
    bodyLarge: GoogleFonts.plusJakartaSans(
      fontSize: 16,
      fontWeight: FontWeight.w400,
      height: 1.45,
      color: onSurface,
    ),
    bodyMedium: GoogleFonts.plusJakartaSans(
      fontSize: 14,
      fontWeight: FontWeight.w500,
      height: 1.4,
      color: onSurface,
    ),
    bodySmall: GoogleFonts.plusJakartaSans(
      fontSize: 13,
      fontWeight: FontWeight.w500,
      height: 1.35,
      color: onSurfaceVariant,
    ),
    labelLarge: GoogleFonts.plusJakartaSans(
      fontSize: 13,
      fontWeight: FontWeight.w700,
      height: 1.2,
      color: onSurface,
    ),
    labelMedium: GoogleFonts.plusJakartaSans(
      fontSize: 12,
      fontWeight: FontWeight.w600,
      height: 1.25,
      color: onSurface,
    ),
    labelSmall: GoogleFonts.plusJakartaSans(
      fontSize: 10,
      fontWeight: FontWeight.w800,
      height: 1.2,
      letterSpacing: 1.15,
      color: onSurfaceVariant,
    ),
  );
}

ThemeData buildDarkAppTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: ColorScheme.fromSeed(
      seedColor: MintObsidian.mint,
      brightness: Brightness.dark,
      primary: const Color(0xFF5EE396),
      secondary: MintObsidian.ocean,
      surface: MintObsidian.surface,
    ),
    scaffoldBackgroundColor: MintObsidian.canvas,
  );

  return base.copyWith(
    textTheme: _busAttendantTextTheme(base.colorScheme),
    appBarTheme: const AppBarTheme(
      elevation: 0,
      centerTitle: true,
      backgroundColor: Colors.transparent,
      foregroundColor: AppColors.white,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: false,
      border: UnderlineInputBorder(
        borderSide: BorderSide(color: AppColors.white.withOpacity(0.6)),
      ),
      enabledBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: AppColors.white.withOpacity(0.5)),
      ),
      focusedBorder: const UnderlineInputBorder(
        borderSide: BorderSide(color: AppColors.white, width: 1.5),
      ),
      labelStyle: const TextStyle(color: AppColors.white),
      hintStyle: TextStyle(color: AppColors.white.withOpacity(0.75)),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        elevation: 0,
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 32),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        backgroundColor: const Color(0xFF5EE396),
        foregroundColor: MintObsidian.textOnMint,
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        elevation: 0,
        padding: const EdgeInsets.symmetric(vertical: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        backgroundColor: const Color(0xFF5EE396),
        foregroundColor: MintObsidian.textOnMint,
        textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 0.5),
      ),
    ),
  );
}

ThemeData buildLightAppTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: ColorScheme.fromSeed(
      seedColor: MintObsidian.mint,
      brightness: Brightness.light,
      primary: const Color(0xFF5EE396),
      secondary: const Color(0xFF2563EB),
      surface: Colors.white,
    ),
    scaffoldBackgroundColor: const Color(0xFFF3F4F6),
  );

  return base.copyWith(
    textTheme: _busAttendantTextTheme(base.colorScheme),
    appBarTheme: const AppBarTheme(
      elevation: 0,
      centerTitle: true,
      backgroundColor: Colors.transparent,
      foregroundColor: Color(0xFF111827),
    ),
    cardTheme: const CardThemeData(
      color: Colors.white,
      elevation: 0,
      shadowColor: Color(0x14000000),
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: false,
      border: UnderlineInputBorder(
        borderSide: BorderSide(color: Colors.black.withOpacity(0.24)),
      ),
      enabledBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: Colors.black.withOpacity(0.2)),
      ),
      focusedBorder: const UnderlineInputBorder(
        borderSide: BorderSide(color: Color(0xFF0EA5A4), width: 1.5),
      ),
      labelStyle: const TextStyle(color: Color(0xFF111827)),
      hintStyle: TextStyle(color: Colors.black.withOpacity(0.56)),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        elevation: 0,
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 32),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        backgroundColor: const Color(0xFF5EE396),
        foregroundColor: const Color(0xFF111827),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        elevation: 0,
        padding: const EdgeInsets.symmetric(vertical: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        backgroundColor: const Color(0xFF5EE396),
        foregroundColor: const Color(0xFF111827),
        textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 0.5),
      ),
    ),
  );
}

ThemeData buildAppTheme() => buildDarkAppTheme();
