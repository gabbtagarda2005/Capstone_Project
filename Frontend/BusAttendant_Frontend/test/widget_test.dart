import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:bus_attendant_app/main.dart';

void main() {
  testWidgets('Bus attendant app builds', (WidgetTester tester) async {
    await tester.pumpWidget(const BusAttendantApp());
    await tester.pump();
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
