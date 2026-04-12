import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_colors.dart';

enum SosAlertLevel { normal, medium, emergency }

extension SosAlertLevelApi on SosAlertLevel {
  String get apiValue {
    switch (this) {
      case SosAlertLevel.normal:
        return 'normal';
      case SosAlertLevel.medium:
        return 'medium';
      case SosAlertLevel.emergency:
        return 'emergency';
    }
  }
}

class SosAlertResult {
  const SosAlertResult({required this.level, required this.note});

  final SosAlertLevel level;
  final String note;
}

/// SOS: three horizontal severity buttons, message field, Send.
Future<SosAlertResult?> showSosAlertDialog(BuildContext context) {
  return showDialog<SosAlertResult>(
    context: context,
    barrierDismissible: true,
    builder: (ctx) => const _SosAlertDialogBody(),
  );
}

class _SosAlertDialogBody extends StatefulWidget {
  const _SosAlertDialogBody();

  @override
  State<_SosAlertDialogBody> createState() => _SosAlertDialogBodyState();
}

class _SosAlertDialogBodyState extends State<_SosAlertDialogBody> {
  SosAlertLevel _level = SosAlertLevel.normal;
  final TextEditingController _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Widget _levelButton(String label, SosAlertLevel value) {
    final on = _level == value;
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => setState(() => _level = value),
            borderRadius: BorderRadius.circular(12),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                color: on ? MintObsidian.mint.withValues(alpha: 0.22) : MintObsidian.surface,
                border: Border.all(
                  color: on ? MintObsidian.mint : Colors.white.withValues(alpha: 0.12),
                  width: on ? 2 : 1,
                ),
              ),
              child: Text(
                label,
                textAlign: TextAlign.center,
                style: GoogleFonts.plusJakartaSans(
                  fontSize: 12,
                  fontWeight: on ? FontWeight.w800 : FontWeight.w600,
                  color: on ? MintObsidian.mint : MintObsidian.textSecondary,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: MintObsidian.surfaceElevated,
      surfaceTintColor: Colors.transparent,
      title: Row(
        children: [
          Expanded(
            child: Text(
              'SOS alert',
              style: GoogleFonts.plusJakartaSans(
                color: MintObsidian.textPrimary,
                fontWeight: FontWeight.w800,
                fontSize: 18,
              ),
            ),
          ),
          IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: Icon(Icons.close_rounded, color: MintObsidian.textSecondary),
            tooltip: 'Close',
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _levelButton('Normal', SosAlertLevel.normal),
                _levelButton('Medium', SosAlertLevel.medium),
                _levelButton('Emergency', SosAlertLevel.emergency),
              ],
            ),
            const SizedBox(height: 18),
            TextField(
              controller: _note,
              style: GoogleFonts.plusJakartaSans(color: MintObsidian.textPrimary, fontSize: 14),
              maxLines: 4,
              decoration: InputDecoration(
                hintText: 'What is the alert for?',
                hintStyle: GoogleFonts.plusJakartaSans(color: MintObsidian.textSecondary),
                filled: true,
                fillColor: MintObsidian.canvas,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: MintObsidian.mint, width: 1.5),
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              ),
            ),
            const SizedBox(height: 18),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: TacticalColors.alertRed,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              onPressed: () {
                Navigator.of(context).pop(
                  SosAlertResult(level: _level, note: _note.text.trim()),
                );
              },
              child: Text(
                'Send',
                style: GoogleFonts.plusJakartaSans(fontWeight: FontWeight.w800, fontSize: 15),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
