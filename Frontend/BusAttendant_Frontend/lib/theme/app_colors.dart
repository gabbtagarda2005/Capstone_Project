import 'package:flutter/material.dart';

/// Monochrome black / white / gray palette.
abstract final class AppColors {
  static const Color tealTop = Color(0xFF2E2E2E);
  static const Color tealDeep = Color(0xFF1E1E1E);
  static const Color tealDark = Color(0xFF0F0F0F);
  static const Color purple = Color(0xFF111111);
  static const Color purpleLight = Color(0xFF3A3A3A);
  static const Color white = Color(0xFFFFFFFF);
  static const Color offWhite = Color(0xFFF5F5F5);
  static const Color textDark = Color(0xFF121212);
  static const Color textMuted = Color(0xFF666666);
  static const Color line = Color(0xFFD9D9D9);

  static const LinearGradient tealHeaderGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [tealTop, tealDeep, tealDark],
  );
}
