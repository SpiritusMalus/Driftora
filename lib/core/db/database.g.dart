// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'database.dart';

// ignore_for_file: type=lint
class $FoodEntriesTable extends FoodEntries
    with TableInfo<$FoodEntriesTable, FoodEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FoodEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _tsMeta = const VerificationMeta('ts');
  @override
  late final GeneratedColumn<DateTime> ts = GeneratedColumn<DateTime>(
    'ts',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _rawTextMeta = const VerificationMeta(
    'rawText',
  );
  @override
  late final GeneratedColumn<String> rawText = GeneratedColumn<String>(
    'raw_text',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  late final GeneratedColumnWithTypeConverter<FoodSource, int> source =
      GeneratedColumn<int>(
        'source',
        aliasedName,
        false,
        type: DriftSqlType.int,
        requiredDuringInsert: true,
      ).withConverter<FoodSource>($FoodEntriesTable.$convertersource);
  static const VerificationMeta _kcalMeta = const VerificationMeta('kcal');
  @override
  late final GeneratedColumn<double> kcal = GeneratedColumn<double>(
    'kcal',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _proteinGMeta = const VerificationMeta(
    'proteinG',
  );
  @override
  late final GeneratedColumn<double> proteinG = GeneratedColumn<double>(
    'protein_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _fatGMeta = const VerificationMeta('fatG');
  @override
  late final GeneratedColumn<double> fatG = GeneratedColumn<double>(
    'fat_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _carbGMeta = const VerificationMeta('carbG');
  @override
  late final GeneratedColumn<double> carbG = GeneratedColumn<double>(
    'carb_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _confirmedMeta = const VerificationMeta(
    'confirmed',
  );
  @override
  late final GeneratedColumn<bool> confirmed = GeneratedColumn<bool>(
    'confirmed',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("confirmed" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    ts,
    rawText,
    source,
    kcal,
    proteinG,
    fatG,
    carbG,
    confirmed,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'food_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<FoodEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('ts')) {
      context.handle(_tsMeta, ts.isAcceptableOrUnknown(data['ts']!, _tsMeta));
    } else if (isInserting) {
      context.missing(_tsMeta);
    }
    if (data.containsKey('raw_text')) {
      context.handle(
        _rawTextMeta,
        rawText.isAcceptableOrUnknown(data['raw_text']!, _rawTextMeta),
      );
    } else if (isInserting) {
      context.missing(_rawTextMeta);
    }
    if (data.containsKey('kcal')) {
      context.handle(
        _kcalMeta,
        kcal.isAcceptableOrUnknown(data['kcal']!, _kcalMeta),
      );
    }
    if (data.containsKey('protein_g')) {
      context.handle(
        _proteinGMeta,
        proteinG.isAcceptableOrUnknown(data['protein_g']!, _proteinGMeta),
      );
    }
    if (data.containsKey('fat_g')) {
      context.handle(
        _fatGMeta,
        fatG.isAcceptableOrUnknown(data['fat_g']!, _fatGMeta),
      );
    }
    if (data.containsKey('carb_g')) {
      context.handle(
        _carbGMeta,
        carbG.isAcceptableOrUnknown(data['carb_g']!, _carbGMeta),
      );
    }
    if (data.containsKey('confirmed')) {
      context.handle(
        _confirmedMeta,
        confirmed.isAcceptableOrUnknown(data['confirmed']!, _confirmedMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  FoodEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FoodEntry(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      ts: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}ts'],
      )!,
      rawText: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}raw_text'],
      )!,
      source: $FoodEntriesTable.$convertersource.fromSql(
        attachedDatabase.typeMapping.read(
          DriftSqlType.int,
          data['${effectivePrefix}source'],
        )!,
      ),
      kcal: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}kcal'],
      )!,
      proteinG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}protein_g'],
      )!,
      fatG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}fat_g'],
      )!,
      carbG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}carb_g'],
      )!,
      confirmed: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}confirmed'],
      )!,
    );
  }

  @override
  $FoodEntriesTable createAlias(String alias) {
    return $FoodEntriesTable(attachedDatabase, alias);
  }

  static JsonTypeConverter2<FoodSource, int, int> $convertersource =
      const EnumIndexConverter<FoodSource>(FoodSource.values);
}

class FoodEntry extends DataClass implements Insertable<FoodEntry> {
  final int id;
  final DateTime ts;
  final String rawText;
  final FoodSource source;
  final double kcal;
  final double proteinG;
  final double fatG;
  final double carbG;
  final bool confirmed;
  const FoodEntry({
    required this.id,
    required this.ts,
    required this.rawText,
    required this.source,
    required this.kcal,
    required this.proteinG,
    required this.fatG,
    required this.carbG,
    required this.confirmed,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['ts'] = Variable<DateTime>(ts);
    map['raw_text'] = Variable<String>(rawText);
    {
      map['source'] = Variable<int>(
        $FoodEntriesTable.$convertersource.toSql(source),
      );
    }
    map['kcal'] = Variable<double>(kcal);
    map['protein_g'] = Variable<double>(proteinG);
    map['fat_g'] = Variable<double>(fatG);
    map['carb_g'] = Variable<double>(carbG);
    map['confirmed'] = Variable<bool>(confirmed);
    return map;
  }

  FoodEntriesCompanion toCompanion(bool nullToAbsent) {
    return FoodEntriesCompanion(
      id: Value(id),
      ts: Value(ts),
      rawText: Value(rawText),
      source: Value(source),
      kcal: Value(kcal),
      proteinG: Value(proteinG),
      fatG: Value(fatG),
      carbG: Value(carbG),
      confirmed: Value(confirmed),
    );
  }

  factory FoodEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FoodEntry(
      id: serializer.fromJson<int>(json['id']),
      ts: serializer.fromJson<DateTime>(json['ts']),
      rawText: serializer.fromJson<String>(json['rawText']),
      source: $FoodEntriesTable.$convertersource.fromJson(
        serializer.fromJson<int>(json['source']),
      ),
      kcal: serializer.fromJson<double>(json['kcal']),
      proteinG: serializer.fromJson<double>(json['proteinG']),
      fatG: serializer.fromJson<double>(json['fatG']),
      carbG: serializer.fromJson<double>(json['carbG']),
      confirmed: serializer.fromJson<bool>(json['confirmed']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'ts': serializer.toJson<DateTime>(ts),
      'rawText': serializer.toJson<String>(rawText),
      'source': serializer.toJson<int>(
        $FoodEntriesTable.$convertersource.toJson(source),
      ),
      'kcal': serializer.toJson<double>(kcal),
      'proteinG': serializer.toJson<double>(proteinG),
      'fatG': serializer.toJson<double>(fatG),
      'carbG': serializer.toJson<double>(carbG),
      'confirmed': serializer.toJson<bool>(confirmed),
    };
  }

  FoodEntry copyWith({
    int? id,
    DateTime? ts,
    String? rawText,
    FoodSource? source,
    double? kcal,
    double? proteinG,
    double? fatG,
    double? carbG,
    bool? confirmed,
  }) => FoodEntry(
    id: id ?? this.id,
    ts: ts ?? this.ts,
    rawText: rawText ?? this.rawText,
    source: source ?? this.source,
    kcal: kcal ?? this.kcal,
    proteinG: proteinG ?? this.proteinG,
    fatG: fatG ?? this.fatG,
    carbG: carbG ?? this.carbG,
    confirmed: confirmed ?? this.confirmed,
  );
  FoodEntry copyWithCompanion(FoodEntriesCompanion data) {
    return FoodEntry(
      id: data.id.present ? data.id.value : this.id,
      ts: data.ts.present ? data.ts.value : this.ts,
      rawText: data.rawText.present ? data.rawText.value : this.rawText,
      source: data.source.present ? data.source.value : this.source,
      kcal: data.kcal.present ? data.kcal.value : this.kcal,
      proteinG: data.proteinG.present ? data.proteinG.value : this.proteinG,
      fatG: data.fatG.present ? data.fatG.value : this.fatG,
      carbG: data.carbG.present ? data.carbG.value : this.carbG,
      confirmed: data.confirmed.present ? data.confirmed.value : this.confirmed,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FoodEntry(')
          ..write('id: $id, ')
          ..write('ts: $ts, ')
          ..write('rawText: $rawText, ')
          ..write('source: $source, ')
          ..write('kcal: $kcal, ')
          ..write('proteinG: $proteinG, ')
          ..write('fatG: $fatG, ')
          ..write('carbG: $carbG, ')
          ..write('confirmed: $confirmed')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    ts,
    rawText,
    source,
    kcal,
    proteinG,
    fatG,
    carbG,
    confirmed,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FoodEntry &&
          other.id == this.id &&
          other.ts == this.ts &&
          other.rawText == this.rawText &&
          other.source == this.source &&
          other.kcal == this.kcal &&
          other.proteinG == this.proteinG &&
          other.fatG == this.fatG &&
          other.carbG == this.carbG &&
          other.confirmed == this.confirmed);
}

class FoodEntriesCompanion extends UpdateCompanion<FoodEntry> {
  final Value<int> id;
  final Value<DateTime> ts;
  final Value<String> rawText;
  final Value<FoodSource> source;
  final Value<double> kcal;
  final Value<double> proteinG;
  final Value<double> fatG;
  final Value<double> carbG;
  final Value<bool> confirmed;
  const FoodEntriesCompanion({
    this.id = const Value.absent(),
    this.ts = const Value.absent(),
    this.rawText = const Value.absent(),
    this.source = const Value.absent(),
    this.kcal = const Value.absent(),
    this.proteinG = const Value.absent(),
    this.fatG = const Value.absent(),
    this.carbG = const Value.absent(),
    this.confirmed = const Value.absent(),
  });
  FoodEntriesCompanion.insert({
    this.id = const Value.absent(),
    required DateTime ts,
    required String rawText,
    required FoodSource source,
    this.kcal = const Value.absent(),
    this.proteinG = const Value.absent(),
    this.fatG = const Value.absent(),
    this.carbG = const Value.absent(),
    this.confirmed = const Value.absent(),
  }) : ts = Value(ts),
       rawText = Value(rawText),
       source = Value(source);
  static Insertable<FoodEntry> custom({
    Expression<int>? id,
    Expression<DateTime>? ts,
    Expression<String>? rawText,
    Expression<int>? source,
    Expression<double>? kcal,
    Expression<double>? proteinG,
    Expression<double>? fatG,
    Expression<double>? carbG,
    Expression<bool>? confirmed,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (ts != null) 'ts': ts,
      if (rawText != null) 'raw_text': rawText,
      if (source != null) 'source': source,
      if (kcal != null) 'kcal': kcal,
      if (proteinG != null) 'protein_g': proteinG,
      if (fatG != null) 'fat_g': fatG,
      if (carbG != null) 'carb_g': carbG,
      if (confirmed != null) 'confirmed': confirmed,
    });
  }

  FoodEntriesCompanion copyWith({
    Value<int>? id,
    Value<DateTime>? ts,
    Value<String>? rawText,
    Value<FoodSource>? source,
    Value<double>? kcal,
    Value<double>? proteinG,
    Value<double>? fatG,
    Value<double>? carbG,
    Value<bool>? confirmed,
  }) {
    return FoodEntriesCompanion(
      id: id ?? this.id,
      ts: ts ?? this.ts,
      rawText: rawText ?? this.rawText,
      source: source ?? this.source,
      kcal: kcal ?? this.kcal,
      proteinG: proteinG ?? this.proteinG,
      fatG: fatG ?? this.fatG,
      carbG: carbG ?? this.carbG,
      confirmed: confirmed ?? this.confirmed,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (ts.present) {
      map['ts'] = Variable<DateTime>(ts.value);
    }
    if (rawText.present) {
      map['raw_text'] = Variable<String>(rawText.value);
    }
    if (source.present) {
      map['source'] = Variable<int>(
        $FoodEntriesTable.$convertersource.toSql(source.value),
      );
    }
    if (kcal.present) {
      map['kcal'] = Variable<double>(kcal.value);
    }
    if (proteinG.present) {
      map['protein_g'] = Variable<double>(proteinG.value);
    }
    if (fatG.present) {
      map['fat_g'] = Variable<double>(fatG.value);
    }
    if (carbG.present) {
      map['carb_g'] = Variable<double>(carbG.value);
    }
    if (confirmed.present) {
      map['confirmed'] = Variable<bool>(confirmed.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FoodEntriesCompanion(')
          ..write('id: $id, ')
          ..write('ts: $ts, ')
          ..write('rawText: $rawText, ')
          ..write('source: $source, ')
          ..write('kcal: $kcal, ')
          ..write('proteinG: $proteinG, ')
          ..write('fatG: $fatG, ')
          ..write('carbG: $carbG, ')
          ..write('confirmed: $confirmed')
          ..write(')'))
        .toString();
  }
}

class $FoodItemsTable extends FoodItems
    with TableInfo<$FoodItemsTable, FoodItem> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $FoodItemsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _entryIdMeta = const VerificationMeta(
    'entryId',
  );
  @override
  late final GeneratedColumn<int> entryId = GeneratedColumn<int>(
    'entry_id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES food_entries (id) ON DELETE CASCADE',
    ),
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _qtyGMeta = const VerificationMeta('qtyG');
  @override
  late final GeneratedColumn<double> qtyG = GeneratedColumn<double>(
    'qty_g',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _kcalMeta = const VerificationMeta('kcal');
  @override
  late final GeneratedColumn<double> kcal = GeneratedColumn<double>(
    'kcal',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _proteinGMeta = const VerificationMeta(
    'proteinG',
  );
  @override
  late final GeneratedColumn<double> proteinG = GeneratedColumn<double>(
    'protein_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _fatGMeta = const VerificationMeta('fatG');
  @override
  late final GeneratedColumn<double> fatG = GeneratedColumn<double>(
    'fat_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _carbGMeta = const VerificationMeta('carbG');
  @override
  late final GeneratedColumn<double> carbG = GeneratedColumn<double>(
    'carb_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    entryId,
    name,
    qtyG,
    kcal,
    proteinG,
    fatG,
    carbG,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'food_items';
  @override
  VerificationContext validateIntegrity(
    Insertable<FoodItem> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('entry_id')) {
      context.handle(
        _entryIdMeta,
        entryId.isAcceptableOrUnknown(data['entry_id']!, _entryIdMeta),
      );
    } else if (isInserting) {
      context.missing(_entryIdMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('qty_g')) {
      context.handle(
        _qtyGMeta,
        qtyG.isAcceptableOrUnknown(data['qty_g']!, _qtyGMeta),
      );
    }
    if (data.containsKey('kcal')) {
      context.handle(
        _kcalMeta,
        kcal.isAcceptableOrUnknown(data['kcal']!, _kcalMeta),
      );
    }
    if (data.containsKey('protein_g')) {
      context.handle(
        _proteinGMeta,
        proteinG.isAcceptableOrUnknown(data['protein_g']!, _proteinGMeta),
      );
    }
    if (data.containsKey('fat_g')) {
      context.handle(
        _fatGMeta,
        fatG.isAcceptableOrUnknown(data['fat_g']!, _fatGMeta),
      );
    }
    if (data.containsKey('carb_g')) {
      context.handle(
        _carbGMeta,
        carbG.isAcceptableOrUnknown(data['carb_g']!, _carbGMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  FoodItem map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return FoodItem(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      entryId: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}entry_id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      qtyG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}qty_g'],
      ),
      kcal: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}kcal'],
      )!,
      proteinG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}protein_g'],
      )!,
      fatG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}fat_g'],
      )!,
      carbG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}carb_g'],
      )!,
    );
  }

  @override
  $FoodItemsTable createAlias(String alias) {
    return $FoodItemsTable(attachedDatabase, alias);
  }
}

class FoodItem extends DataClass implements Insertable<FoodItem> {
  final int id;
  final int entryId;
  final String name;
  final double? qtyG;
  final double kcal;
  final double proteinG;
  final double fatG;
  final double carbG;
  const FoodItem({
    required this.id,
    required this.entryId,
    required this.name,
    this.qtyG,
    required this.kcal,
    required this.proteinG,
    required this.fatG,
    required this.carbG,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['entry_id'] = Variable<int>(entryId);
    map['name'] = Variable<String>(name);
    if (!nullToAbsent || qtyG != null) {
      map['qty_g'] = Variable<double>(qtyG);
    }
    map['kcal'] = Variable<double>(kcal);
    map['protein_g'] = Variable<double>(proteinG);
    map['fat_g'] = Variable<double>(fatG);
    map['carb_g'] = Variable<double>(carbG);
    return map;
  }

  FoodItemsCompanion toCompanion(bool nullToAbsent) {
    return FoodItemsCompanion(
      id: Value(id),
      entryId: Value(entryId),
      name: Value(name),
      qtyG: qtyG == null && nullToAbsent ? const Value.absent() : Value(qtyG),
      kcal: Value(kcal),
      proteinG: Value(proteinG),
      fatG: Value(fatG),
      carbG: Value(carbG),
    );
  }

  factory FoodItem.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return FoodItem(
      id: serializer.fromJson<int>(json['id']),
      entryId: serializer.fromJson<int>(json['entryId']),
      name: serializer.fromJson<String>(json['name']),
      qtyG: serializer.fromJson<double?>(json['qtyG']),
      kcal: serializer.fromJson<double>(json['kcal']),
      proteinG: serializer.fromJson<double>(json['proteinG']),
      fatG: serializer.fromJson<double>(json['fatG']),
      carbG: serializer.fromJson<double>(json['carbG']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'entryId': serializer.toJson<int>(entryId),
      'name': serializer.toJson<String>(name),
      'qtyG': serializer.toJson<double?>(qtyG),
      'kcal': serializer.toJson<double>(kcal),
      'proteinG': serializer.toJson<double>(proteinG),
      'fatG': serializer.toJson<double>(fatG),
      'carbG': serializer.toJson<double>(carbG),
    };
  }

  FoodItem copyWith({
    int? id,
    int? entryId,
    String? name,
    Value<double?> qtyG = const Value.absent(),
    double? kcal,
    double? proteinG,
    double? fatG,
    double? carbG,
  }) => FoodItem(
    id: id ?? this.id,
    entryId: entryId ?? this.entryId,
    name: name ?? this.name,
    qtyG: qtyG.present ? qtyG.value : this.qtyG,
    kcal: kcal ?? this.kcal,
    proteinG: proteinG ?? this.proteinG,
    fatG: fatG ?? this.fatG,
    carbG: carbG ?? this.carbG,
  );
  FoodItem copyWithCompanion(FoodItemsCompanion data) {
    return FoodItem(
      id: data.id.present ? data.id.value : this.id,
      entryId: data.entryId.present ? data.entryId.value : this.entryId,
      name: data.name.present ? data.name.value : this.name,
      qtyG: data.qtyG.present ? data.qtyG.value : this.qtyG,
      kcal: data.kcal.present ? data.kcal.value : this.kcal,
      proteinG: data.proteinG.present ? data.proteinG.value : this.proteinG,
      fatG: data.fatG.present ? data.fatG.value : this.fatG,
      carbG: data.carbG.present ? data.carbG.value : this.carbG,
    );
  }

  @override
  String toString() {
    return (StringBuffer('FoodItem(')
          ..write('id: $id, ')
          ..write('entryId: $entryId, ')
          ..write('name: $name, ')
          ..write('qtyG: $qtyG, ')
          ..write('kcal: $kcal, ')
          ..write('proteinG: $proteinG, ')
          ..write('fatG: $fatG, ')
          ..write('carbG: $carbG')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, entryId, name, qtyG, kcal, proteinG, fatG, carbG);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is FoodItem &&
          other.id == this.id &&
          other.entryId == this.entryId &&
          other.name == this.name &&
          other.qtyG == this.qtyG &&
          other.kcal == this.kcal &&
          other.proteinG == this.proteinG &&
          other.fatG == this.fatG &&
          other.carbG == this.carbG);
}

class FoodItemsCompanion extends UpdateCompanion<FoodItem> {
  final Value<int> id;
  final Value<int> entryId;
  final Value<String> name;
  final Value<double?> qtyG;
  final Value<double> kcal;
  final Value<double> proteinG;
  final Value<double> fatG;
  final Value<double> carbG;
  const FoodItemsCompanion({
    this.id = const Value.absent(),
    this.entryId = const Value.absent(),
    this.name = const Value.absent(),
    this.qtyG = const Value.absent(),
    this.kcal = const Value.absent(),
    this.proteinG = const Value.absent(),
    this.fatG = const Value.absent(),
    this.carbG = const Value.absent(),
  });
  FoodItemsCompanion.insert({
    this.id = const Value.absent(),
    required int entryId,
    required String name,
    this.qtyG = const Value.absent(),
    this.kcal = const Value.absent(),
    this.proteinG = const Value.absent(),
    this.fatG = const Value.absent(),
    this.carbG = const Value.absent(),
  }) : entryId = Value(entryId),
       name = Value(name);
  static Insertable<FoodItem> custom({
    Expression<int>? id,
    Expression<int>? entryId,
    Expression<String>? name,
    Expression<double>? qtyG,
    Expression<double>? kcal,
    Expression<double>? proteinG,
    Expression<double>? fatG,
    Expression<double>? carbG,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (entryId != null) 'entry_id': entryId,
      if (name != null) 'name': name,
      if (qtyG != null) 'qty_g': qtyG,
      if (kcal != null) 'kcal': kcal,
      if (proteinG != null) 'protein_g': proteinG,
      if (fatG != null) 'fat_g': fatG,
      if (carbG != null) 'carb_g': carbG,
    });
  }

  FoodItemsCompanion copyWith({
    Value<int>? id,
    Value<int>? entryId,
    Value<String>? name,
    Value<double?>? qtyG,
    Value<double>? kcal,
    Value<double>? proteinG,
    Value<double>? fatG,
    Value<double>? carbG,
  }) {
    return FoodItemsCompanion(
      id: id ?? this.id,
      entryId: entryId ?? this.entryId,
      name: name ?? this.name,
      qtyG: qtyG ?? this.qtyG,
      kcal: kcal ?? this.kcal,
      proteinG: proteinG ?? this.proteinG,
      fatG: fatG ?? this.fatG,
      carbG: carbG ?? this.carbG,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (entryId.present) {
      map['entry_id'] = Variable<int>(entryId.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (qtyG.present) {
      map['qty_g'] = Variable<double>(qtyG.value);
    }
    if (kcal.present) {
      map['kcal'] = Variable<double>(kcal.value);
    }
    if (proteinG.present) {
      map['protein_g'] = Variable<double>(proteinG.value);
    }
    if (fatG.present) {
      map['fat_g'] = Variable<double>(fatG.value);
    }
    if (carbG.present) {
      map['carb_g'] = Variable<double>(carbG.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('FoodItemsCompanion(')
          ..write('id: $id, ')
          ..write('entryId: $entryId, ')
          ..write('name: $name, ')
          ..write('qtyG: $qtyG, ')
          ..write('kcal: $kcal, ')
          ..write('proteinG: $proteinG, ')
          ..write('fatG: $fatG, ')
          ..write('carbG: $carbG')
          ..write(')'))
        .toString();
  }
}

class $StepsDaysTable extends StepsDays
    with TableInfo<$StepsDaysTable, StepsDay> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $StepsDaysTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _dateMeta = const VerificationMeta('date');
  @override
  late final GeneratedColumn<DateTime> date = GeneratedColumn<DateTime>(
    'date',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stepsMeta = const VerificationMeta('steps');
  @override
  late final GeneratedColumn<int> steps = GeneratedColumn<int>(
    'steps',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _syncedAtMeta = const VerificationMeta(
    'syncedAt',
  );
  @override
  late final GeneratedColumn<DateTime> syncedAt = GeneratedColumn<DateTime>(
    'synced_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [date, steps, syncedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'steps_days';
  @override
  VerificationContext validateIntegrity(
    Insertable<StepsDay> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('date')) {
      context.handle(
        _dateMeta,
        date.isAcceptableOrUnknown(data['date']!, _dateMeta),
      );
    } else if (isInserting) {
      context.missing(_dateMeta);
    }
    if (data.containsKey('steps')) {
      context.handle(
        _stepsMeta,
        steps.isAcceptableOrUnknown(data['steps']!, _stepsMeta),
      );
    }
    if (data.containsKey('synced_at')) {
      context.handle(
        _syncedAtMeta,
        syncedAt.isAcceptableOrUnknown(data['synced_at']!, _syncedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_syncedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {date};
  @override
  StepsDay map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return StepsDay(
      date: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}date'],
      )!,
      steps: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}steps'],
      )!,
      syncedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}synced_at'],
      )!,
    );
  }

  @override
  $StepsDaysTable createAlias(String alias) {
    return $StepsDaysTable(attachedDatabase, alias);
  }
}

class StepsDay extends DataClass implements Insertable<StepsDay> {
  /// Local date at midnight; the primary key.
  final DateTime date;
  final int steps;
  final DateTime syncedAt;
  const StepsDay({
    required this.date,
    required this.steps,
    required this.syncedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['date'] = Variable<DateTime>(date);
    map['steps'] = Variable<int>(steps);
    map['synced_at'] = Variable<DateTime>(syncedAt);
    return map;
  }

  StepsDaysCompanion toCompanion(bool nullToAbsent) {
    return StepsDaysCompanion(
      date: Value(date),
      steps: Value(steps),
      syncedAt: Value(syncedAt),
    );
  }

  factory StepsDay.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return StepsDay(
      date: serializer.fromJson<DateTime>(json['date']),
      steps: serializer.fromJson<int>(json['steps']),
      syncedAt: serializer.fromJson<DateTime>(json['syncedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'date': serializer.toJson<DateTime>(date),
      'steps': serializer.toJson<int>(steps),
      'syncedAt': serializer.toJson<DateTime>(syncedAt),
    };
  }

  StepsDay copyWith({DateTime? date, int? steps, DateTime? syncedAt}) =>
      StepsDay(
        date: date ?? this.date,
        steps: steps ?? this.steps,
        syncedAt: syncedAt ?? this.syncedAt,
      );
  StepsDay copyWithCompanion(StepsDaysCompanion data) {
    return StepsDay(
      date: data.date.present ? data.date.value : this.date,
      steps: data.steps.present ? data.steps.value : this.steps,
      syncedAt: data.syncedAt.present ? data.syncedAt.value : this.syncedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('StepsDay(')
          ..write('date: $date, ')
          ..write('steps: $steps, ')
          ..write('syncedAt: $syncedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(date, steps, syncedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is StepsDay &&
          other.date == this.date &&
          other.steps == this.steps &&
          other.syncedAt == this.syncedAt);
}

class StepsDaysCompanion extends UpdateCompanion<StepsDay> {
  final Value<DateTime> date;
  final Value<int> steps;
  final Value<DateTime> syncedAt;
  final Value<int> rowid;
  const StepsDaysCompanion({
    this.date = const Value.absent(),
    this.steps = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  StepsDaysCompanion.insert({
    required DateTime date,
    this.steps = const Value.absent(),
    required DateTime syncedAt,
    this.rowid = const Value.absent(),
  }) : date = Value(date),
       syncedAt = Value(syncedAt);
  static Insertable<StepsDay> custom({
    Expression<DateTime>? date,
    Expression<int>? steps,
    Expression<DateTime>? syncedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (date != null) 'date': date,
      if (steps != null) 'steps': steps,
      if (syncedAt != null) 'synced_at': syncedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  StepsDaysCompanion copyWith({
    Value<DateTime>? date,
    Value<int>? steps,
    Value<DateTime>? syncedAt,
    Value<int>? rowid,
  }) {
    return StepsDaysCompanion(
      date: date ?? this.date,
      steps: steps ?? this.steps,
      syncedAt: syncedAt ?? this.syncedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (date.present) {
      map['date'] = Variable<DateTime>(date.value);
    }
    if (steps.present) {
      map['steps'] = Variable<int>(steps.value);
    }
    if (syncedAt.present) {
      map['synced_at'] = Variable<DateTime>(syncedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('StepsDaysCompanion(')
          ..write('date: $date, ')
          ..write('steps: $steps, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $DiaryEntriesTable extends DiaryEntries
    with TableInfo<$DiaryEntriesTable, DiaryEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DiaryEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _tsMeta = const VerificationMeta('ts');
  @override
  late final GeneratedColumn<DateTime> ts = GeneratedColumn<DateTime>(
    'ts',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _situationMeta = const VerificationMeta(
    'situation',
  );
  @override
  late final GeneratedColumn<String> situation = GeneratedColumn<String>(
    'situation',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _thoughtsMeta = const VerificationMeta(
    'thoughts',
  );
  @override
  late final GeneratedColumn<String> thoughts = GeneratedColumn<String>(
    'thoughts',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _emotionsMeta = const VerificationMeta(
    'emotions',
  );
  @override
  late final GeneratedColumn<String> emotions = GeneratedColumn<String>(
    'emotions',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _reactionBodyMeta = const VerificationMeta(
    'reactionBody',
  );
  @override
  late final GeneratedColumn<String> reactionBody = GeneratedColumn<String>(
    'reaction_body',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _reactionBehaviorMeta = const VerificationMeta(
    'reactionBehavior',
  );
  @override
  late final GeneratedColumn<String> reactionBehavior = GeneratedColumn<String>(
    'reaction_behavior',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _evidenceForMeta = const VerificationMeta(
    'evidenceFor',
  );
  @override
  late final GeneratedColumn<String> evidenceFor = GeneratedColumn<String>(
    'evidence_for',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _evidenceAgainstMeta = const VerificationMeta(
    'evidenceAgainst',
  );
  @override
  late final GeneratedColumn<String> evidenceAgainst = GeneratedColumn<String>(
    'evidence_against',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _reframeMeta = const VerificationMeta(
    'reframe',
  );
  @override
  late final GeneratedColumn<String> reframe = GeneratedColumn<String>(
    'reframe',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _moodMeta = const VerificationMeta('mood');
  @override
  late final GeneratedColumn<int> mood = GeneratedColumn<int>(
    'mood',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    ts,
    situation,
    thoughts,
    emotions,
    reactionBody,
    reactionBehavior,
    evidenceFor,
    evidenceAgainst,
    reframe,
    mood,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'diary_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<DiaryEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('ts')) {
      context.handle(_tsMeta, ts.isAcceptableOrUnknown(data['ts']!, _tsMeta));
    } else if (isInserting) {
      context.missing(_tsMeta);
    }
    if (data.containsKey('situation')) {
      context.handle(
        _situationMeta,
        situation.isAcceptableOrUnknown(data['situation']!, _situationMeta),
      );
    }
    if (data.containsKey('thoughts')) {
      context.handle(
        _thoughtsMeta,
        thoughts.isAcceptableOrUnknown(data['thoughts']!, _thoughtsMeta),
      );
    }
    if (data.containsKey('emotions')) {
      context.handle(
        _emotionsMeta,
        emotions.isAcceptableOrUnknown(data['emotions']!, _emotionsMeta),
      );
    }
    if (data.containsKey('reaction_body')) {
      context.handle(
        _reactionBodyMeta,
        reactionBody.isAcceptableOrUnknown(
          data['reaction_body']!,
          _reactionBodyMeta,
        ),
      );
    }
    if (data.containsKey('reaction_behavior')) {
      context.handle(
        _reactionBehaviorMeta,
        reactionBehavior.isAcceptableOrUnknown(
          data['reaction_behavior']!,
          _reactionBehaviorMeta,
        ),
      );
    }
    if (data.containsKey('evidence_for')) {
      context.handle(
        _evidenceForMeta,
        evidenceFor.isAcceptableOrUnknown(
          data['evidence_for']!,
          _evidenceForMeta,
        ),
      );
    }
    if (data.containsKey('evidence_against')) {
      context.handle(
        _evidenceAgainstMeta,
        evidenceAgainst.isAcceptableOrUnknown(
          data['evidence_against']!,
          _evidenceAgainstMeta,
        ),
      );
    }
    if (data.containsKey('reframe')) {
      context.handle(
        _reframeMeta,
        reframe.isAcceptableOrUnknown(data['reframe']!, _reframeMeta),
      );
    }
    if (data.containsKey('mood')) {
      context.handle(
        _moodMeta,
        mood.isAcceptableOrUnknown(data['mood']!, _moodMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  DiaryEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DiaryEntry(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      ts: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}ts'],
      )!,
      situation: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}situation'],
      )!,
      thoughts: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}thoughts'],
      )!,
      emotions: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}emotions'],
      )!,
      reactionBody: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reaction_body'],
      )!,
      reactionBehavior: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reaction_behavior'],
      )!,
      evidenceFor: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}evidence_for'],
      )!,
      evidenceAgainst: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}evidence_against'],
      )!,
      reframe: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reframe'],
      )!,
      mood: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}mood'],
      ),
    );
  }

  @override
  $DiaryEntriesTable createAlias(String alias) {
    return $DiaryEntriesTable(attachedDatabase, alias);
  }
}

class DiaryEntry extends DataClass implements Insertable<DiaryEntry> {
  final int id;
  final DateTime ts;
  final String situation;
  final String thoughts;
  final String emotions;
  final String reactionBody;
  final String reactionBehavior;
  final String evidenceFor;
  final String evidenceAgainst;
  final String reframe;

  /// Overall mood, 0..10 (nullable until the user sets it).
  final int? mood;
  const DiaryEntry({
    required this.id,
    required this.ts,
    required this.situation,
    required this.thoughts,
    required this.emotions,
    required this.reactionBody,
    required this.reactionBehavior,
    required this.evidenceFor,
    required this.evidenceAgainst,
    required this.reframe,
    this.mood,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['ts'] = Variable<DateTime>(ts);
    map['situation'] = Variable<String>(situation);
    map['thoughts'] = Variable<String>(thoughts);
    map['emotions'] = Variable<String>(emotions);
    map['reaction_body'] = Variable<String>(reactionBody);
    map['reaction_behavior'] = Variable<String>(reactionBehavior);
    map['evidence_for'] = Variable<String>(evidenceFor);
    map['evidence_against'] = Variable<String>(evidenceAgainst);
    map['reframe'] = Variable<String>(reframe);
    if (!nullToAbsent || mood != null) {
      map['mood'] = Variable<int>(mood);
    }
    return map;
  }

  DiaryEntriesCompanion toCompanion(bool nullToAbsent) {
    return DiaryEntriesCompanion(
      id: Value(id),
      ts: Value(ts),
      situation: Value(situation),
      thoughts: Value(thoughts),
      emotions: Value(emotions),
      reactionBody: Value(reactionBody),
      reactionBehavior: Value(reactionBehavior),
      evidenceFor: Value(evidenceFor),
      evidenceAgainst: Value(evidenceAgainst),
      reframe: Value(reframe),
      mood: mood == null && nullToAbsent ? const Value.absent() : Value(mood),
    );
  }

  factory DiaryEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DiaryEntry(
      id: serializer.fromJson<int>(json['id']),
      ts: serializer.fromJson<DateTime>(json['ts']),
      situation: serializer.fromJson<String>(json['situation']),
      thoughts: serializer.fromJson<String>(json['thoughts']),
      emotions: serializer.fromJson<String>(json['emotions']),
      reactionBody: serializer.fromJson<String>(json['reactionBody']),
      reactionBehavior: serializer.fromJson<String>(json['reactionBehavior']),
      evidenceFor: serializer.fromJson<String>(json['evidenceFor']),
      evidenceAgainst: serializer.fromJson<String>(json['evidenceAgainst']),
      reframe: serializer.fromJson<String>(json['reframe']),
      mood: serializer.fromJson<int?>(json['mood']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'ts': serializer.toJson<DateTime>(ts),
      'situation': serializer.toJson<String>(situation),
      'thoughts': serializer.toJson<String>(thoughts),
      'emotions': serializer.toJson<String>(emotions),
      'reactionBody': serializer.toJson<String>(reactionBody),
      'reactionBehavior': serializer.toJson<String>(reactionBehavior),
      'evidenceFor': serializer.toJson<String>(evidenceFor),
      'evidenceAgainst': serializer.toJson<String>(evidenceAgainst),
      'reframe': serializer.toJson<String>(reframe),
      'mood': serializer.toJson<int?>(mood),
    };
  }

  DiaryEntry copyWith({
    int? id,
    DateTime? ts,
    String? situation,
    String? thoughts,
    String? emotions,
    String? reactionBody,
    String? reactionBehavior,
    String? evidenceFor,
    String? evidenceAgainst,
    String? reframe,
    Value<int?> mood = const Value.absent(),
  }) => DiaryEntry(
    id: id ?? this.id,
    ts: ts ?? this.ts,
    situation: situation ?? this.situation,
    thoughts: thoughts ?? this.thoughts,
    emotions: emotions ?? this.emotions,
    reactionBody: reactionBody ?? this.reactionBody,
    reactionBehavior: reactionBehavior ?? this.reactionBehavior,
    evidenceFor: evidenceFor ?? this.evidenceFor,
    evidenceAgainst: evidenceAgainst ?? this.evidenceAgainst,
    reframe: reframe ?? this.reframe,
    mood: mood.present ? mood.value : this.mood,
  );
  DiaryEntry copyWithCompanion(DiaryEntriesCompanion data) {
    return DiaryEntry(
      id: data.id.present ? data.id.value : this.id,
      ts: data.ts.present ? data.ts.value : this.ts,
      situation: data.situation.present ? data.situation.value : this.situation,
      thoughts: data.thoughts.present ? data.thoughts.value : this.thoughts,
      emotions: data.emotions.present ? data.emotions.value : this.emotions,
      reactionBody: data.reactionBody.present
          ? data.reactionBody.value
          : this.reactionBody,
      reactionBehavior: data.reactionBehavior.present
          ? data.reactionBehavior.value
          : this.reactionBehavior,
      evidenceFor: data.evidenceFor.present
          ? data.evidenceFor.value
          : this.evidenceFor,
      evidenceAgainst: data.evidenceAgainst.present
          ? data.evidenceAgainst.value
          : this.evidenceAgainst,
      reframe: data.reframe.present ? data.reframe.value : this.reframe,
      mood: data.mood.present ? data.mood.value : this.mood,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DiaryEntry(')
          ..write('id: $id, ')
          ..write('ts: $ts, ')
          ..write('situation: $situation, ')
          ..write('thoughts: $thoughts, ')
          ..write('emotions: $emotions, ')
          ..write('reactionBody: $reactionBody, ')
          ..write('reactionBehavior: $reactionBehavior, ')
          ..write('evidenceFor: $evidenceFor, ')
          ..write('evidenceAgainst: $evidenceAgainst, ')
          ..write('reframe: $reframe, ')
          ..write('mood: $mood')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    ts,
    situation,
    thoughts,
    emotions,
    reactionBody,
    reactionBehavior,
    evidenceFor,
    evidenceAgainst,
    reframe,
    mood,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DiaryEntry &&
          other.id == this.id &&
          other.ts == this.ts &&
          other.situation == this.situation &&
          other.thoughts == this.thoughts &&
          other.emotions == this.emotions &&
          other.reactionBody == this.reactionBody &&
          other.reactionBehavior == this.reactionBehavior &&
          other.evidenceFor == this.evidenceFor &&
          other.evidenceAgainst == this.evidenceAgainst &&
          other.reframe == this.reframe &&
          other.mood == this.mood);
}

class DiaryEntriesCompanion extends UpdateCompanion<DiaryEntry> {
  final Value<int> id;
  final Value<DateTime> ts;
  final Value<String> situation;
  final Value<String> thoughts;
  final Value<String> emotions;
  final Value<String> reactionBody;
  final Value<String> reactionBehavior;
  final Value<String> evidenceFor;
  final Value<String> evidenceAgainst;
  final Value<String> reframe;
  final Value<int?> mood;
  const DiaryEntriesCompanion({
    this.id = const Value.absent(),
    this.ts = const Value.absent(),
    this.situation = const Value.absent(),
    this.thoughts = const Value.absent(),
    this.emotions = const Value.absent(),
    this.reactionBody = const Value.absent(),
    this.reactionBehavior = const Value.absent(),
    this.evidenceFor = const Value.absent(),
    this.evidenceAgainst = const Value.absent(),
    this.reframe = const Value.absent(),
    this.mood = const Value.absent(),
  });
  DiaryEntriesCompanion.insert({
    this.id = const Value.absent(),
    required DateTime ts,
    this.situation = const Value.absent(),
    this.thoughts = const Value.absent(),
    this.emotions = const Value.absent(),
    this.reactionBody = const Value.absent(),
    this.reactionBehavior = const Value.absent(),
    this.evidenceFor = const Value.absent(),
    this.evidenceAgainst = const Value.absent(),
    this.reframe = const Value.absent(),
    this.mood = const Value.absent(),
  }) : ts = Value(ts);
  static Insertable<DiaryEntry> custom({
    Expression<int>? id,
    Expression<DateTime>? ts,
    Expression<String>? situation,
    Expression<String>? thoughts,
    Expression<String>? emotions,
    Expression<String>? reactionBody,
    Expression<String>? reactionBehavior,
    Expression<String>? evidenceFor,
    Expression<String>? evidenceAgainst,
    Expression<String>? reframe,
    Expression<int>? mood,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (ts != null) 'ts': ts,
      if (situation != null) 'situation': situation,
      if (thoughts != null) 'thoughts': thoughts,
      if (emotions != null) 'emotions': emotions,
      if (reactionBody != null) 'reaction_body': reactionBody,
      if (reactionBehavior != null) 'reaction_behavior': reactionBehavior,
      if (evidenceFor != null) 'evidence_for': evidenceFor,
      if (evidenceAgainst != null) 'evidence_against': evidenceAgainst,
      if (reframe != null) 'reframe': reframe,
      if (mood != null) 'mood': mood,
    });
  }

  DiaryEntriesCompanion copyWith({
    Value<int>? id,
    Value<DateTime>? ts,
    Value<String>? situation,
    Value<String>? thoughts,
    Value<String>? emotions,
    Value<String>? reactionBody,
    Value<String>? reactionBehavior,
    Value<String>? evidenceFor,
    Value<String>? evidenceAgainst,
    Value<String>? reframe,
    Value<int?>? mood,
  }) {
    return DiaryEntriesCompanion(
      id: id ?? this.id,
      ts: ts ?? this.ts,
      situation: situation ?? this.situation,
      thoughts: thoughts ?? this.thoughts,
      emotions: emotions ?? this.emotions,
      reactionBody: reactionBody ?? this.reactionBody,
      reactionBehavior: reactionBehavior ?? this.reactionBehavior,
      evidenceFor: evidenceFor ?? this.evidenceFor,
      evidenceAgainst: evidenceAgainst ?? this.evidenceAgainst,
      reframe: reframe ?? this.reframe,
      mood: mood ?? this.mood,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (ts.present) {
      map['ts'] = Variable<DateTime>(ts.value);
    }
    if (situation.present) {
      map['situation'] = Variable<String>(situation.value);
    }
    if (thoughts.present) {
      map['thoughts'] = Variable<String>(thoughts.value);
    }
    if (emotions.present) {
      map['emotions'] = Variable<String>(emotions.value);
    }
    if (reactionBody.present) {
      map['reaction_body'] = Variable<String>(reactionBody.value);
    }
    if (reactionBehavior.present) {
      map['reaction_behavior'] = Variable<String>(reactionBehavior.value);
    }
    if (evidenceFor.present) {
      map['evidence_for'] = Variable<String>(evidenceFor.value);
    }
    if (evidenceAgainst.present) {
      map['evidence_against'] = Variable<String>(evidenceAgainst.value);
    }
    if (reframe.present) {
      map['reframe'] = Variable<String>(reframe.value);
    }
    if (mood.present) {
      map['mood'] = Variable<int>(mood.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DiaryEntriesCompanion(')
          ..write('id: $id, ')
          ..write('ts: $ts, ')
          ..write('situation: $situation, ')
          ..write('thoughts: $thoughts, ')
          ..write('emotions: $emotions, ')
          ..write('reactionBody: $reactionBody, ')
          ..write('reactionBehavior: $reactionBehavior, ')
          ..write('evidenceFor: $evidenceFor, ')
          ..write('evidenceAgainst: $evidenceAgainst, ')
          ..write('reframe: $reframe, ')
          ..write('mood: $mood')
          ..write(')'))
        .toString();
  }
}

class $WinsTable extends Wins with TableInfo<$WinsTable, Win> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $WinsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _tsMeta = const VerificationMeta('ts');
  @override
  late final GeneratedColumn<DateTime> ts = GeneratedColumn<DateTime>(
    'ts',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _messageMeta = const VerificationMeta(
    'message',
  );
  @override
  late final GeneratedColumn<String> message = GeneratedColumn<String>(
    'message',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [id, ts, kind, message];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'wins';
  @override
  VerificationContext validateIntegrity(
    Insertable<Win> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('ts')) {
      context.handle(_tsMeta, ts.isAcceptableOrUnknown(data['ts']!, _tsMeta));
    } else if (isInserting) {
      context.missing(_tsMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('message')) {
      context.handle(
        _messageMeta,
        message.isAcceptableOrUnknown(data['message']!, _messageMeta),
      );
    } else if (isInserting) {
      context.missing(_messageMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  Win map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Win(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      ts: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}ts'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      message: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}message'],
      )!,
    );
  }

  @override
  $WinsTable createAlias(String alias) {
    return $WinsTable(attachedDatabase, alias);
  }
}

class Win extends DataClass implements Insertable<Win> {
  final int id;
  final DateTime ts;
  final String kind;
  final String message;
  const Win({
    required this.id,
    required this.ts,
    required this.kind,
    required this.message,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['ts'] = Variable<DateTime>(ts);
    map['kind'] = Variable<String>(kind);
    map['message'] = Variable<String>(message);
    return map;
  }

  WinsCompanion toCompanion(bool nullToAbsent) {
    return WinsCompanion(
      id: Value(id),
      ts: Value(ts),
      kind: Value(kind),
      message: Value(message),
    );
  }

  factory Win.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Win(
      id: serializer.fromJson<int>(json['id']),
      ts: serializer.fromJson<DateTime>(json['ts']),
      kind: serializer.fromJson<String>(json['kind']),
      message: serializer.fromJson<String>(json['message']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'ts': serializer.toJson<DateTime>(ts),
      'kind': serializer.toJson<String>(kind),
      'message': serializer.toJson<String>(message),
    };
  }

  Win copyWith({int? id, DateTime? ts, String? kind, String? message}) => Win(
    id: id ?? this.id,
    ts: ts ?? this.ts,
    kind: kind ?? this.kind,
    message: message ?? this.message,
  );
  Win copyWithCompanion(WinsCompanion data) {
    return Win(
      id: data.id.present ? data.id.value : this.id,
      ts: data.ts.present ? data.ts.value : this.ts,
      kind: data.kind.present ? data.kind.value : this.kind,
      message: data.message.present ? data.message.value : this.message,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Win(')
          ..write('id: $id, ')
          ..write('ts: $ts, ')
          ..write('kind: $kind, ')
          ..write('message: $message')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, ts, kind, message);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Win &&
          other.id == this.id &&
          other.ts == this.ts &&
          other.kind == this.kind &&
          other.message == this.message);
}

class WinsCompanion extends UpdateCompanion<Win> {
  final Value<int> id;
  final Value<DateTime> ts;
  final Value<String> kind;
  final Value<String> message;
  const WinsCompanion({
    this.id = const Value.absent(),
    this.ts = const Value.absent(),
    this.kind = const Value.absent(),
    this.message = const Value.absent(),
  });
  WinsCompanion.insert({
    this.id = const Value.absent(),
    required DateTime ts,
    required String kind,
    required String message,
  }) : ts = Value(ts),
       kind = Value(kind),
       message = Value(message);
  static Insertable<Win> custom({
    Expression<int>? id,
    Expression<DateTime>? ts,
    Expression<String>? kind,
    Expression<String>? message,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (ts != null) 'ts': ts,
      if (kind != null) 'kind': kind,
      if (message != null) 'message': message,
    });
  }

  WinsCompanion copyWith({
    Value<int>? id,
    Value<DateTime>? ts,
    Value<String>? kind,
    Value<String>? message,
  }) {
    return WinsCompanion(
      id: id ?? this.id,
      ts: ts ?? this.ts,
      kind: kind ?? this.kind,
      message: message ?? this.message,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (ts.present) {
      map['ts'] = Variable<DateTime>(ts.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (message.present) {
      map['message'] = Variable<String>(message.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('WinsCompanion(')
          ..write('id: $id, ')
          ..write('ts: $ts, ')
          ..write('kind: $kind, ')
          ..write('message: $message')
          ..write(')'))
        .toString();
  }
}

class $AppSettingsRowsTable extends AppSettingsRows
    with TableInfo<$AppSettingsRowsTable, AppSettingsRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $AppSettingsRowsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _targetKcalMeta = const VerificationMeta(
    'targetKcal',
  );
  @override
  late final GeneratedColumn<double> targetKcal = GeneratedColumn<double>(
    'target_kcal',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(2000),
  );
  static const VerificationMeta _targetProteinGMeta = const VerificationMeta(
    'targetProteinG',
  );
  @override
  late final GeneratedColumn<double> targetProteinG = GeneratedColumn<double>(
    'target_protein_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(120),
  );
  static const VerificationMeta _targetFatGMeta = const VerificationMeta(
    'targetFatG',
  );
  @override
  late final GeneratedColumn<double> targetFatG = GeneratedColumn<double>(
    'target_fat_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(70),
  );
  static const VerificationMeta _targetCarbGMeta = const VerificationMeta(
    'targetCarbG',
  );
  @override
  late final GeneratedColumn<double> targetCarbG = GeneratedColumn<double>(
    'target_carb_g',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(200),
  );
  static const VerificationMeta _stepsGoalMeta = const VerificationMeta(
    'stepsGoal',
  );
  @override
  late final GeneratedColumn<int> stepsGoal = GeneratedColumn<int>(
    'steps_goal',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(7000),
  );
  static const VerificationMeta _reminderTimesMeta = const VerificationMeta(
    'reminderTimes',
  );
  @override
  late final GeneratedColumn<String> reminderTimes = GeneratedColumn<String>(
    'reminder_times',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('[]'),
  );
  static const VerificationMeta _hideCaloriesMeta = const VerificationMeta(
    'hideCalories',
  );
  @override
  late final GeneratedColumn<bool> hideCalories = GeneratedColumn<bool>(
    'hide_calories',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("hide_calories" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _llmDiaryAssistMeta = const VerificationMeta(
    'llmDiaryAssist',
  );
  @override
  late final GeneratedColumn<bool> llmDiaryAssist = GeneratedColumn<bool>(
    'llm_diary_assist',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("llm_diary_assist" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    targetKcal,
    targetProteinG,
    targetFatG,
    targetCarbG,
    stepsGoal,
    reminderTimes,
    hideCalories,
    llmDiaryAssist,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'app_settings_rows';
  @override
  VerificationContext validateIntegrity(
    Insertable<AppSettingsRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('target_kcal')) {
      context.handle(
        _targetKcalMeta,
        targetKcal.isAcceptableOrUnknown(data['target_kcal']!, _targetKcalMeta),
      );
    }
    if (data.containsKey('target_protein_g')) {
      context.handle(
        _targetProteinGMeta,
        targetProteinG.isAcceptableOrUnknown(
          data['target_protein_g']!,
          _targetProteinGMeta,
        ),
      );
    }
    if (data.containsKey('target_fat_g')) {
      context.handle(
        _targetFatGMeta,
        targetFatG.isAcceptableOrUnknown(
          data['target_fat_g']!,
          _targetFatGMeta,
        ),
      );
    }
    if (data.containsKey('target_carb_g')) {
      context.handle(
        _targetCarbGMeta,
        targetCarbG.isAcceptableOrUnknown(
          data['target_carb_g']!,
          _targetCarbGMeta,
        ),
      );
    }
    if (data.containsKey('steps_goal')) {
      context.handle(
        _stepsGoalMeta,
        stepsGoal.isAcceptableOrUnknown(data['steps_goal']!, _stepsGoalMeta),
      );
    }
    if (data.containsKey('reminder_times')) {
      context.handle(
        _reminderTimesMeta,
        reminderTimes.isAcceptableOrUnknown(
          data['reminder_times']!,
          _reminderTimesMeta,
        ),
      );
    }
    if (data.containsKey('hide_calories')) {
      context.handle(
        _hideCaloriesMeta,
        hideCalories.isAcceptableOrUnknown(
          data['hide_calories']!,
          _hideCaloriesMeta,
        ),
      );
    }
    if (data.containsKey('llm_diary_assist')) {
      context.handle(
        _llmDiaryAssistMeta,
        llmDiaryAssist.isAcceptableOrUnknown(
          data['llm_diary_assist']!,
          _llmDiaryAssistMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  AppSettingsRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return AppSettingsRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      targetKcal: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}target_kcal'],
      )!,
      targetProteinG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}target_protein_g'],
      )!,
      targetFatG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}target_fat_g'],
      )!,
      targetCarbG: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}target_carb_g'],
      )!,
      stepsGoal: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}steps_goal'],
      )!,
      reminderTimes: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}reminder_times'],
      )!,
      hideCalories: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}hide_calories'],
      )!,
      llmDiaryAssist: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}llm_diary_assist'],
      )!,
    );
  }

  @override
  $AppSettingsRowsTable createAlias(String alias) {
    return $AppSettingsRowsTable(attachedDatabase, alias);
  }
}

class AppSettingsRow extends DataClass implements Insertable<AppSettingsRow> {
  final int id;
  final double targetKcal;
  final double targetProteinG;
  final double targetFatG;
  final double targetCarbG;

  /// Personal, achievable goal — deliberately NOT the "10,000 steps" myth.
  final int stepsGoal;
  final String reminderTimes;

  /// Privacy/UX guardrail flags.
  final bool hideCalories;
  final bool llmDiaryAssist;
  const AppSettingsRow({
    required this.id,
    required this.targetKcal,
    required this.targetProteinG,
    required this.targetFatG,
    required this.targetCarbG,
    required this.stepsGoal,
    required this.reminderTimes,
    required this.hideCalories,
    required this.llmDiaryAssist,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['target_kcal'] = Variable<double>(targetKcal);
    map['target_protein_g'] = Variable<double>(targetProteinG);
    map['target_fat_g'] = Variable<double>(targetFatG);
    map['target_carb_g'] = Variable<double>(targetCarbG);
    map['steps_goal'] = Variable<int>(stepsGoal);
    map['reminder_times'] = Variable<String>(reminderTimes);
    map['hide_calories'] = Variable<bool>(hideCalories);
    map['llm_diary_assist'] = Variable<bool>(llmDiaryAssist);
    return map;
  }

  AppSettingsRowsCompanion toCompanion(bool nullToAbsent) {
    return AppSettingsRowsCompanion(
      id: Value(id),
      targetKcal: Value(targetKcal),
      targetProteinG: Value(targetProteinG),
      targetFatG: Value(targetFatG),
      targetCarbG: Value(targetCarbG),
      stepsGoal: Value(stepsGoal),
      reminderTimes: Value(reminderTimes),
      hideCalories: Value(hideCalories),
      llmDiaryAssist: Value(llmDiaryAssist),
    );
  }

  factory AppSettingsRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return AppSettingsRow(
      id: serializer.fromJson<int>(json['id']),
      targetKcal: serializer.fromJson<double>(json['targetKcal']),
      targetProteinG: serializer.fromJson<double>(json['targetProteinG']),
      targetFatG: serializer.fromJson<double>(json['targetFatG']),
      targetCarbG: serializer.fromJson<double>(json['targetCarbG']),
      stepsGoal: serializer.fromJson<int>(json['stepsGoal']),
      reminderTimes: serializer.fromJson<String>(json['reminderTimes']),
      hideCalories: serializer.fromJson<bool>(json['hideCalories']),
      llmDiaryAssist: serializer.fromJson<bool>(json['llmDiaryAssist']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'targetKcal': serializer.toJson<double>(targetKcal),
      'targetProteinG': serializer.toJson<double>(targetProteinG),
      'targetFatG': serializer.toJson<double>(targetFatG),
      'targetCarbG': serializer.toJson<double>(targetCarbG),
      'stepsGoal': serializer.toJson<int>(stepsGoal),
      'reminderTimes': serializer.toJson<String>(reminderTimes),
      'hideCalories': serializer.toJson<bool>(hideCalories),
      'llmDiaryAssist': serializer.toJson<bool>(llmDiaryAssist),
    };
  }

  AppSettingsRow copyWith({
    int? id,
    double? targetKcal,
    double? targetProteinG,
    double? targetFatG,
    double? targetCarbG,
    int? stepsGoal,
    String? reminderTimes,
    bool? hideCalories,
    bool? llmDiaryAssist,
  }) => AppSettingsRow(
    id: id ?? this.id,
    targetKcal: targetKcal ?? this.targetKcal,
    targetProteinG: targetProteinG ?? this.targetProteinG,
    targetFatG: targetFatG ?? this.targetFatG,
    targetCarbG: targetCarbG ?? this.targetCarbG,
    stepsGoal: stepsGoal ?? this.stepsGoal,
    reminderTimes: reminderTimes ?? this.reminderTimes,
    hideCalories: hideCalories ?? this.hideCalories,
    llmDiaryAssist: llmDiaryAssist ?? this.llmDiaryAssist,
  );
  AppSettingsRow copyWithCompanion(AppSettingsRowsCompanion data) {
    return AppSettingsRow(
      id: data.id.present ? data.id.value : this.id,
      targetKcal: data.targetKcal.present
          ? data.targetKcal.value
          : this.targetKcal,
      targetProteinG: data.targetProteinG.present
          ? data.targetProteinG.value
          : this.targetProteinG,
      targetFatG: data.targetFatG.present
          ? data.targetFatG.value
          : this.targetFatG,
      targetCarbG: data.targetCarbG.present
          ? data.targetCarbG.value
          : this.targetCarbG,
      stepsGoal: data.stepsGoal.present ? data.stepsGoal.value : this.stepsGoal,
      reminderTimes: data.reminderTimes.present
          ? data.reminderTimes.value
          : this.reminderTimes,
      hideCalories: data.hideCalories.present
          ? data.hideCalories.value
          : this.hideCalories,
      llmDiaryAssist: data.llmDiaryAssist.present
          ? data.llmDiaryAssist.value
          : this.llmDiaryAssist,
    );
  }

  @override
  String toString() {
    return (StringBuffer('AppSettingsRow(')
          ..write('id: $id, ')
          ..write('targetKcal: $targetKcal, ')
          ..write('targetProteinG: $targetProteinG, ')
          ..write('targetFatG: $targetFatG, ')
          ..write('targetCarbG: $targetCarbG, ')
          ..write('stepsGoal: $stepsGoal, ')
          ..write('reminderTimes: $reminderTimes, ')
          ..write('hideCalories: $hideCalories, ')
          ..write('llmDiaryAssist: $llmDiaryAssist')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    targetKcal,
    targetProteinG,
    targetFatG,
    targetCarbG,
    stepsGoal,
    reminderTimes,
    hideCalories,
    llmDiaryAssist,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AppSettingsRow &&
          other.id == this.id &&
          other.targetKcal == this.targetKcal &&
          other.targetProteinG == this.targetProteinG &&
          other.targetFatG == this.targetFatG &&
          other.targetCarbG == this.targetCarbG &&
          other.stepsGoal == this.stepsGoal &&
          other.reminderTimes == this.reminderTimes &&
          other.hideCalories == this.hideCalories &&
          other.llmDiaryAssist == this.llmDiaryAssist);
}

class AppSettingsRowsCompanion extends UpdateCompanion<AppSettingsRow> {
  final Value<int> id;
  final Value<double> targetKcal;
  final Value<double> targetProteinG;
  final Value<double> targetFatG;
  final Value<double> targetCarbG;
  final Value<int> stepsGoal;
  final Value<String> reminderTimes;
  final Value<bool> hideCalories;
  final Value<bool> llmDiaryAssist;
  const AppSettingsRowsCompanion({
    this.id = const Value.absent(),
    this.targetKcal = const Value.absent(),
    this.targetProteinG = const Value.absent(),
    this.targetFatG = const Value.absent(),
    this.targetCarbG = const Value.absent(),
    this.stepsGoal = const Value.absent(),
    this.reminderTimes = const Value.absent(),
    this.hideCalories = const Value.absent(),
    this.llmDiaryAssist = const Value.absent(),
  });
  AppSettingsRowsCompanion.insert({
    this.id = const Value.absent(),
    this.targetKcal = const Value.absent(),
    this.targetProteinG = const Value.absent(),
    this.targetFatG = const Value.absent(),
    this.targetCarbG = const Value.absent(),
    this.stepsGoal = const Value.absent(),
    this.reminderTimes = const Value.absent(),
    this.hideCalories = const Value.absent(),
    this.llmDiaryAssist = const Value.absent(),
  });
  static Insertable<AppSettingsRow> custom({
    Expression<int>? id,
    Expression<double>? targetKcal,
    Expression<double>? targetProteinG,
    Expression<double>? targetFatG,
    Expression<double>? targetCarbG,
    Expression<int>? stepsGoal,
    Expression<String>? reminderTimes,
    Expression<bool>? hideCalories,
    Expression<bool>? llmDiaryAssist,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (targetKcal != null) 'target_kcal': targetKcal,
      if (targetProteinG != null) 'target_protein_g': targetProteinG,
      if (targetFatG != null) 'target_fat_g': targetFatG,
      if (targetCarbG != null) 'target_carb_g': targetCarbG,
      if (stepsGoal != null) 'steps_goal': stepsGoal,
      if (reminderTimes != null) 'reminder_times': reminderTimes,
      if (hideCalories != null) 'hide_calories': hideCalories,
      if (llmDiaryAssist != null) 'llm_diary_assist': llmDiaryAssist,
    });
  }

  AppSettingsRowsCompanion copyWith({
    Value<int>? id,
    Value<double>? targetKcal,
    Value<double>? targetProteinG,
    Value<double>? targetFatG,
    Value<double>? targetCarbG,
    Value<int>? stepsGoal,
    Value<String>? reminderTimes,
    Value<bool>? hideCalories,
    Value<bool>? llmDiaryAssist,
  }) {
    return AppSettingsRowsCompanion(
      id: id ?? this.id,
      targetKcal: targetKcal ?? this.targetKcal,
      targetProteinG: targetProteinG ?? this.targetProteinG,
      targetFatG: targetFatG ?? this.targetFatG,
      targetCarbG: targetCarbG ?? this.targetCarbG,
      stepsGoal: stepsGoal ?? this.stepsGoal,
      reminderTimes: reminderTimes ?? this.reminderTimes,
      hideCalories: hideCalories ?? this.hideCalories,
      llmDiaryAssist: llmDiaryAssist ?? this.llmDiaryAssist,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (targetKcal.present) {
      map['target_kcal'] = Variable<double>(targetKcal.value);
    }
    if (targetProteinG.present) {
      map['target_protein_g'] = Variable<double>(targetProteinG.value);
    }
    if (targetFatG.present) {
      map['target_fat_g'] = Variable<double>(targetFatG.value);
    }
    if (targetCarbG.present) {
      map['target_carb_g'] = Variable<double>(targetCarbG.value);
    }
    if (stepsGoal.present) {
      map['steps_goal'] = Variable<int>(stepsGoal.value);
    }
    if (reminderTimes.present) {
      map['reminder_times'] = Variable<String>(reminderTimes.value);
    }
    if (hideCalories.present) {
      map['hide_calories'] = Variable<bool>(hideCalories.value);
    }
    if (llmDiaryAssist.present) {
      map['llm_diary_assist'] = Variable<bool>(llmDiaryAssist.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('AppSettingsRowsCompanion(')
          ..write('id: $id, ')
          ..write('targetKcal: $targetKcal, ')
          ..write('targetProteinG: $targetProteinG, ')
          ..write('targetFatG: $targetFatG, ')
          ..write('targetCarbG: $targetCarbG, ')
          ..write('stepsGoal: $stepsGoal, ')
          ..write('reminderTimes: $reminderTimes, ')
          ..write('hideCalories: $hideCalories, ')
          ..write('llmDiaryAssist: $llmDiaryAssist')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $FoodEntriesTable foodEntries = $FoodEntriesTable(this);
  late final $FoodItemsTable foodItems = $FoodItemsTable(this);
  late final $StepsDaysTable stepsDays = $StepsDaysTable(this);
  late final $DiaryEntriesTable diaryEntries = $DiaryEntriesTable(this);
  late final $WinsTable wins = $WinsTable(this);
  late final $AppSettingsRowsTable appSettingsRows = $AppSettingsRowsTable(
    this,
  );
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    foodEntries,
    foodItems,
    stepsDays,
    diaryEntries,
    wins,
    appSettingsRows,
  ];
  @override
  StreamQueryUpdateRules get streamUpdateRules => const StreamQueryUpdateRules([
    WritePropagation(
      on: TableUpdateQuery.onTableName(
        'food_entries',
        limitUpdateKind: UpdateKind.delete,
      ),
      result: [TableUpdate('food_items', kind: UpdateKind.delete)],
    ),
  ]);
}

typedef $$FoodEntriesTableCreateCompanionBuilder =
    FoodEntriesCompanion Function({
      Value<int> id,
      required DateTime ts,
      required String rawText,
      required FoodSource source,
      Value<double> kcal,
      Value<double> proteinG,
      Value<double> fatG,
      Value<double> carbG,
      Value<bool> confirmed,
    });
typedef $$FoodEntriesTableUpdateCompanionBuilder =
    FoodEntriesCompanion Function({
      Value<int> id,
      Value<DateTime> ts,
      Value<String> rawText,
      Value<FoodSource> source,
      Value<double> kcal,
      Value<double> proteinG,
      Value<double> fatG,
      Value<double> carbG,
      Value<bool> confirmed,
    });

final class $$FoodEntriesTableReferences
    extends BaseReferences<_$AppDatabase, $FoodEntriesTable, FoodEntry> {
  $$FoodEntriesTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static MultiTypedResultKey<$FoodItemsTable, List<FoodItem>>
  _foodItemsRefsTable(_$AppDatabase db) => MultiTypedResultKey.fromTable(
    db.foodItems,
    aliasName: 'food_entries__id__food_items__entry_id',
  );

  $$FoodItemsTableProcessedTableManager get foodItemsRefs {
    final manager = $$FoodItemsTableTableManager(
      $_db,
      $_db.foodItems,
    ).filter((f) => f.entryId.id.sqlEquals($_itemColumn<int>('id')!));

    final cache = $_typedResult.readTableOrNull(_foodItemsRefsTable($_db));
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: cache),
    );
  }
}

class $$FoodEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $FoodEntriesTable> {
  $$FoodEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get ts => $composableBuilder(
    column: $table.ts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get rawText => $composableBuilder(
    column: $table.rawText,
    builder: (column) => ColumnFilters(column),
  );

  ColumnWithTypeConverterFilters<FoodSource, FoodSource, int> get source =>
      $composableBuilder(
        column: $table.source,
        builder: (column) => ColumnWithTypeConverterFilters(column),
      );

  ColumnFilters<double> get kcal => $composableBuilder(
    column: $table.kcal,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get proteinG => $composableBuilder(
    column: $table.proteinG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get fatG => $composableBuilder(
    column: $table.fatG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get carbG => $composableBuilder(
    column: $table.carbG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get confirmed => $composableBuilder(
    column: $table.confirmed,
    builder: (column) => ColumnFilters(column),
  );

  Expression<bool> foodItemsRefs(
    Expression<bool> Function($$FoodItemsTableFilterComposer f) f,
  ) {
    final $$FoodItemsTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.id,
      referencedTable: $db.foodItems,
      getReferencedColumn: (t) => t.entryId,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$FoodItemsTableFilterComposer(
            $db: $db,
            $table: $db.foodItems,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$FoodEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $FoodEntriesTable> {
  $$FoodEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get ts => $composableBuilder(
    column: $table.ts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get rawText => $composableBuilder(
    column: $table.rawText,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get source => $composableBuilder(
    column: $table.source,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get kcal => $composableBuilder(
    column: $table.kcal,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get proteinG => $composableBuilder(
    column: $table.proteinG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get fatG => $composableBuilder(
    column: $table.fatG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get carbG => $composableBuilder(
    column: $table.carbG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get confirmed => $composableBuilder(
    column: $table.confirmed,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$FoodEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $FoodEntriesTable> {
  $$FoodEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get ts =>
      $composableBuilder(column: $table.ts, builder: (column) => column);

  GeneratedColumn<String> get rawText =>
      $composableBuilder(column: $table.rawText, builder: (column) => column);

  GeneratedColumnWithTypeConverter<FoodSource, int> get source =>
      $composableBuilder(column: $table.source, builder: (column) => column);

  GeneratedColumn<double> get kcal =>
      $composableBuilder(column: $table.kcal, builder: (column) => column);

  GeneratedColumn<double> get proteinG =>
      $composableBuilder(column: $table.proteinG, builder: (column) => column);

  GeneratedColumn<double> get fatG =>
      $composableBuilder(column: $table.fatG, builder: (column) => column);

  GeneratedColumn<double> get carbG =>
      $composableBuilder(column: $table.carbG, builder: (column) => column);

  GeneratedColumn<bool> get confirmed =>
      $composableBuilder(column: $table.confirmed, builder: (column) => column);

  Expression<T> foodItemsRefs<T extends Object>(
    Expression<T> Function($$FoodItemsTableAnnotationComposer a) f,
  ) {
    final $$FoodItemsTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.id,
      referencedTable: $db.foodItems,
      getReferencedColumn: (t) => t.entryId,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$FoodItemsTableAnnotationComposer(
            $db: $db,
            $table: $db.foodItems,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return f(composer);
  }
}

class $$FoodEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FoodEntriesTable,
          FoodEntry,
          $$FoodEntriesTableFilterComposer,
          $$FoodEntriesTableOrderingComposer,
          $$FoodEntriesTableAnnotationComposer,
          $$FoodEntriesTableCreateCompanionBuilder,
          $$FoodEntriesTableUpdateCompanionBuilder,
          (FoodEntry, $$FoodEntriesTableReferences),
          FoodEntry,
          PrefetchHooks Function({bool foodItemsRefs})
        > {
  $$FoodEntriesTableTableManager(_$AppDatabase db, $FoodEntriesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FoodEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FoodEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FoodEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<DateTime> ts = const Value.absent(),
                Value<String> rawText = const Value.absent(),
                Value<FoodSource> source = const Value.absent(),
                Value<double> kcal = const Value.absent(),
                Value<double> proteinG = const Value.absent(),
                Value<double> fatG = const Value.absent(),
                Value<double> carbG = const Value.absent(),
                Value<bool> confirmed = const Value.absent(),
              }) => FoodEntriesCompanion(
                id: id,
                ts: ts,
                rawText: rawText,
                source: source,
                kcal: kcal,
                proteinG: proteinG,
                fatG: fatG,
                carbG: carbG,
                confirmed: confirmed,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required DateTime ts,
                required String rawText,
                required FoodSource source,
                Value<double> kcal = const Value.absent(),
                Value<double> proteinG = const Value.absent(),
                Value<double> fatG = const Value.absent(),
                Value<double> carbG = const Value.absent(),
                Value<bool> confirmed = const Value.absent(),
              }) => FoodEntriesCompanion.insert(
                id: id,
                ts: ts,
                rawText: rawText,
                source: source,
                kcal: kcal,
                proteinG: proteinG,
                fatG: fatG,
                carbG: carbG,
                confirmed: confirmed,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  $$FoodEntriesTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({foodItemsRefs = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [if (foodItemsRefs) db.foodItems],
              addJoins: null,
              getPrefetchedDataCallback: (items) async {
                return [
                  if (foodItemsRefs)
                    await $_getPrefetchedData<
                      FoodEntry,
                      $FoodEntriesTable,
                      FoodItem
                    >(
                      currentTable: table,
                      referencedTable: $$FoodEntriesTableReferences
                          ._foodItemsRefsTable(db),
                      managerFromTypedResult: (p0) =>
                          $$FoodEntriesTableReferences(
                            db,
                            table,
                            p0,
                          ).foodItemsRefs,
                      referencedItemsForCurrentItem: (item, referencedItems) =>
                          referencedItems.where((e) => e.entryId == item.id),
                      typedResults: items,
                    ),
                ];
              },
            );
          },
        ),
      );
}

typedef $$FoodEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FoodEntriesTable,
      FoodEntry,
      $$FoodEntriesTableFilterComposer,
      $$FoodEntriesTableOrderingComposer,
      $$FoodEntriesTableAnnotationComposer,
      $$FoodEntriesTableCreateCompanionBuilder,
      $$FoodEntriesTableUpdateCompanionBuilder,
      (FoodEntry, $$FoodEntriesTableReferences),
      FoodEntry,
      PrefetchHooks Function({bool foodItemsRefs})
    >;
typedef $$FoodItemsTableCreateCompanionBuilder =
    FoodItemsCompanion Function({
      Value<int> id,
      required int entryId,
      required String name,
      Value<double?> qtyG,
      Value<double> kcal,
      Value<double> proteinG,
      Value<double> fatG,
      Value<double> carbG,
    });
typedef $$FoodItemsTableUpdateCompanionBuilder =
    FoodItemsCompanion Function({
      Value<int> id,
      Value<int> entryId,
      Value<String> name,
      Value<double?> qtyG,
      Value<double> kcal,
      Value<double> proteinG,
      Value<double> fatG,
      Value<double> carbG,
    });

final class $$FoodItemsTableReferences
    extends BaseReferences<_$AppDatabase, $FoodItemsTable, FoodItem> {
  $$FoodItemsTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static $FoodEntriesTable _entryIdTable(_$AppDatabase db) =>
      db.foodEntries.createAlias('food_items__entry_id__food_entries__id');

  $$FoodEntriesTableProcessedTableManager get entryId {
    final $_column = $_itemColumn<int>('entry_id')!;

    final manager = $$FoodEntriesTableTableManager(
      $_db,
      $_db.foodEntries,
    ).filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_entryIdTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$FoodItemsTableFilterComposer
    extends Composer<_$AppDatabase, $FoodItemsTable> {
  $$FoodItemsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get qtyG => $composableBuilder(
    column: $table.qtyG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get kcal => $composableBuilder(
    column: $table.kcal,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get proteinG => $composableBuilder(
    column: $table.proteinG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get fatG => $composableBuilder(
    column: $table.fatG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get carbG => $composableBuilder(
    column: $table.carbG,
    builder: (column) => ColumnFilters(column),
  );

  $$FoodEntriesTableFilterComposer get entryId {
    final $$FoodEntriesTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.entryId,
      referencedTable: $db.foodEntries,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$FoodEntriesTableFilterComposer(
            $db: $db,
            $table: $db.foodEntries,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$FoodItemsTableOrderingComposer
    extends Composer<_$AppDatabase, $FoodItemsTable> {
  $$FoodItemsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get qtyG => $composableBuilder(
    column: $table.qtyG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get kcal => $composableBuilder(
    column: $table.kcal,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get proteinG => $composableBuilder(
    column: $table.proteinG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get fatG => $composableBuilder(
    column: $table.fatG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get carbG => $composableBuilder(
    column: $table.carbG,
    builder: (column) => ColumnOrderings(column),
  );

  $$FoodEntriesTableOrderingComposer get entryId {
    final $$FoodEntriesTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.entryId,
      referencedTable: $db.foodEntries,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$FoodEntriesTableOrderingComposer(
            $db: $db,
            $table: $db.foodEntries,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$FoodItemsTableAnnotationComposer
    extends Composer<_$AppDatabase, $FoodItemsTable> {
  $$FoodItemsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<double> get qtyG =>
      $composableBuilder(column: $table.qtyG, builder: (column) => column);

  GeneratedColumn<double> get kcal =>
      $composableBuilder(column: $table.kcal, builder: (column) => column);

  GeneratedColumn<double> get proteinG =>
      $composableBuilder(column: $table.proteinG, builder: (column) => column);

  GeneratedColumn<double> get fatG =>
      $composableBuilder(column: $table.fatG, builder: (column) => column);

  GeneratedColumn<double> get carbG =>
      $composableBuilder(column: $table.carbG, builder: (column) => column);

  $$FoodEntriesTableAnnotationComposer get entryId {
    final $$FoodEntriesTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.entryId,
      referencedTable: $db.foodEntries,
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => $$FoodEntriesTableAnnotationComposer(
            $db: $db,
            $table: $db.foodEntries,
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$FoodItemsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $FoodItemsTable,
          FoodItem,
          $$FoodItemsTableFilterComposer,
          $$FoodItemsTableOrderingComposer,
          $$FoodItemsTableAnnotationComposer,
          $$FoodItemsTableCreateCompanionBuilder,
          $$FoodItemsTableUpdateCompanionBuilder,
          (FoodItem, $$FoodItemsTableReferences),
          FoodItem,
          PrefetchHooks Function({bool entryId})
        > {
  $$FoodItemsTableTableManager(_$AppDatabase db, $FoodItemsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$FoodItemsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$FoodItemsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$FoodItemsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<int> entryId = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<double?> qtyG = const Value.absent(),
                Value<double> kcal = const Value.absent(),
                Value<double> proteinG = const Value.absent(),
                Value<double> fatG = const Value.absent(),
                Value<double> carbG = const Value.absent(),
              }) => FoodItemsCompanion(
                id: id,
                entryId: entryId,
                name: name,
                qtyG: qtyG,
                kcal: kcal,
                proteinG: proteinG,
                fatG: fatG,
                carbG: carbG,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required int entryId,
                required String name,
                Value<double?> qtyG = const Value.absent(),
                Value<double> kcal = const Value.absent(),
                Value<double> proteinG = const Value.absent(),
                Value<double> fatG = const Value.absent(),
                Value<double> carbG = const Value.absent(),
              }) => FoodItemsCompanion.insert(
                id: id,
                entryId: entryId,
                name: name,
                qtyG: qtyG,
                kcal: kcal,
                proteinG: proteinG,
                fatG: fatG,
                carbG: carbG,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  $$FoodItemsTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({entryId = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins:
                  <
                    T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic
                    >
                  >(state) {
                    if (entryId) {
                      state =
                          state.withJoin(
                                currentTable: table,
                                currentColumn: table.entryId,
                                referencedTable: $$FoodItemsTableReferences
                                    ._entryIdTable(db),
                                referencedColumn: $$FoodItemsTableReferences
                                    ._entryIdTable(db)
                                    .id,
                              )
                              as T;
                    }

                    return state;
                  },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ),
      );
}

typedef $$FoodItemsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $FoodItemsTable,
      FoodItem,
      $$FoodItemsTableFilterComposer,
      $$FoodItemsTableOrderingComposer,
      $$FoodItemsTableAnnotationComposer,
      $$FoodItemsTableCreateCompanionBuilder,
      $$FoodItemsTableUpdateCompanionBuilder,
      (FoodItem, $$FoodItemsTableReferences),
      FoodItem,
      PrefetchHooks Function({bool entryId})
    >;
typedef $$StepsDaysTableCreateCompanionBuilder =
    StepsDaysCompanion Function({
      required DateTime date,
      Value<int> steps,
      required DateTime syncedAt,
      Value<int> rowid,
    });
typedef $$StepsDaysTableUpdateCompanionBuilder =
    StepsDaysCompanion Function({
      Value<DateTime> date,
      Value<int> steps,
      Value<DateTime> syncedAt,
      Value<int> rowid,
    });

class $$StepsDaysTableFilterComposer
    extends Composer<_$AppDatabase, $StepsDaysTable> {
  $$StepsDaysTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<DateTime> get date => $composableBuilder(
    column: $table.date,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get steps => $composableBuilder(
    column: $table.steps,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$StepsDaysTableOrderingComposer
    extends Composer<_$AppDatabase, $StepsDaysTable> {
  $$StepsDaysTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<DateTime> get date => $composableBuilder(
    column: $table.date,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get steps => $composableBuilder(
    column: $table.steps,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$StepsDaysTableAnnotationComposer
    extends Composer<_$AppDatabase, $StepsDaysTable> {
  $$StepsDaysTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<DateTime> get date =>
      $composableBuilder(column: $table.date, builder: (column) => column);

  GeneratedColumn<int> get steps =>
      $composableBuilder(column: $table.steps, builder: (column) => column);

  GeneratedColumn<DateTime> get syncedAt =>
      $composableBuilder(column: $table.syncedAt, builder: (column) => column);
}

class $$StepsDaysTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $StepsDaysTable,
          StepsDay,
          $$StepsDaysTableFilterComposer,
          $$StepsDaysTableOrderingComposer,
          $$StepsDaysTableAnnotationComposer,
          $$StepsDaysTableCreateCompanionBuilder,
          $$StepsDaysTableUpdateCompanionBuilder,
          (StepsDay, BaseReferences<_$AppDatabase, $StepsDaysTable, StepsDay>),
          StepsDay,
          PrefetchHooks Function()
        > {
  $$StepsDaysTableTableManager(_$AppDatabase db, $StepsDaysTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$StepsDaysTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$StepsDaysTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$StepsDaysTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<DateTime> date = const Value.absent(),
                Value<int> steps = const Value.absent(),
                Value<DateTime> syncedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => StepsDaysCompanion(
                date: date,
                steps: steps,
                syncedAt: syncedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required DateTime date,
                Value<int> steps = const Value.absent(),
                required DateTime syncedAt,
                Value<int> rowid = const Value.absent(),
              }) => StepsDaysCompanion.insert(
                date: date,
                steps: steps,
                syncedAt: syncedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$StepsDaysTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $StepsDaysTable,
      StepsDay,
      $$StepsDaysTableFilterComposer,
      $$StepsDaysTableOrderingComposer,
      $$StepsDaysTableAnnotationComposer,
      $$StepsDaysTableCreateCompanionBuilder,
      $$StepsDaysTableUpdateCompanionBuilder,
      (StepsDay, BaseReferences<_$AppDatabase, $StepsDaysTable, StepsDay>),
      StepsDay,
      PrefetchHooks Function()
    >;
typedef $$DiaryEntriesTableCreateCompanionBuilder =
    DiaryEntriesCompanion Function({
      Value<int> id,
      required DateTime ts,
      Value<String> situation,
      Value<String> thoughts,
      Value<String> emotions,
      Value<String> reactionBody,
      Value<String> reactionBehavior,
      Value<String> evidenceFor,
      Value<String> evidenceAgainst,
      Value<String> reframe,
      Value<int?> mood,
    });
typedef $$DiaryEntriesTableUpdateCompanionBuilder =
    DiaryEntriesCompanion Function({
      Value<int> id,
      Value<DateTime> ts,
      Value<String> situation,
      Value<String> thoughts,
      Value<String> emotions,
      Value<String> reactionBody,
      Value<String> reactionBehavior,
      Value<String> evidenceFor,
      Value<String> evidenceAgainst,
      Value<String> reframe,
      Value<int?> mood,
    });

class $$DiaryEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $DiaryEntriesTable> {
  $$DiaryEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get ts => $composableBuilder(
    column: $table.ts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get situation => $composableBuilder(
    column: $table.situation,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get thoughts => $composableBuilder(
    column: $table.thoughts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get emotions => $composableBuilder(
    column: $table.emotions,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reactionBody => $composableBuilder(
    column: $table.reactionBody,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reactionBehavior => $composableBuilder(
    column: $table.reactionBehavior,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get evidenceFor => $composableBuilder(
    column: $table.evidenceFor,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get evidenceAgainst => $composableBuilder(
    column: $table.evidenceAgainst,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reframe => $composableBuilder(
    column: $table.reframe,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get mood => $composableBuilder(
    column: $table.mood,
    builder: (column) => ColumnFilters(column),
  );
}

class $$DiaryEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $DiaryEntriesTable> {
  $$DiaryEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get ts => $composableBuilder(
    column: $table.ts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get situation => $composableBuilder(
    column: $table.situation,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get thoughts => $composableBuilder(
    column: $table.thoughts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get emotions => $composableBuilder(
    column: $table.emotions,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reactionBody => $composableBuilder(
    column: $table.reactionBody,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reactionBehavior => $composableBuilder(
    column: $table.reactionBehavior,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get evidenceFor => $composableBuilder(
    column: $table.evidenceFor,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get evidenceAgainst => $composableBuilder(
    column: $table.evidenceAgainst,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reframe => $composableBuilder(
    column: $table.reframe,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get mood => $composableBuilder(
    column: $table.mood,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$DiaryEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $DiaryEntriesTable> {
  $$DiaryEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get ts =>
      $composableBuilder(column: $table.ts, builder: (column) => column);

  GeneratedColumn<String> get situation =>
      $composableBuilder(column: $table.situation, builder: (column) => column);

  GeneratedColumn<String> get thoughts =>
      $composableBuilder(column: $table.thoughts, builder: (column) => column);

  GeneratedColumn<String> get emotions =>
      $composableBuilder(column: $table.emotions, builder: (column) => column);

  GeneratedColumn<String> get reactionBody => $composableBuilder(
    column: $table.reactionBody,
    builder: (column) => column,
  );

  GeneratedColumn<String> get reactionBehavior => $composableBuilder(
    column: $table.reactionBehavior,
    builder: (column) => column,
  );

  GeneratedColumn<String> get evidenceFor => $composableBuilder(
    column: $table.evidenceFor,
    builder: (column) => column,
  );

  GeneratedColumn<String> get evidenceAgainst => $composableBuilder(
    column: $table.evidenceAgainst,
    builder: (column) => column,
  );

  GeneratedColumn<String> get reframe =>
      $composableBuilder(column: $table.reframe, builder: (column) => column);

  GeneratedColumn<int> get mood =>
      $composableBuilder(column: $table.mood, builder: (column) => column);
}

class $$DiaryEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $DiaryEntriesTable,
          DiaryEntry,
          $$DiaryEntriesTableFilterComposer,
          $$DiaryEntriesTableOrderingComposer,
          $$DiaryEntriesTableAnnotationComposer,
          $$DiaryEntriesTableCreateCompanionBuilder,
          $$DiaryEntriesTableUpdateCompanionBuilder,
          (
            DiaryEntry,
            BaseReferences<_$AppDatabase, $DiaryEntriesTable, DiaryEntry>,
          ),
          DiaryEntry,
          PrefetchHooks Function()
        > {
  $$DiaryEntriesTableTableManager(_$AppDatabase db, $DiaryEntriesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$DiaryEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$DiaryEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$DiaryEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<DateTime> ts = const Value.absent(),
                Value<String> situation = const Value.absent(),
                Value<String> thoughts = const Value.absent(),
                Value<String> emotions = const Value.absent(),
                Value<String> reactionBody = const Value.absent(),
                Value<String> reactionBehavior = const Value.absent(),
                Value<String> evidenceFor = const Value.absent(),
                Value<String> evidenceAgainst = const Value.absent(),
                Value<String> reframe = const Value.absent(),
                Value<int?> mood = const Value.absent(),
              }) => DiaryEntriesCompanion(
                id: id,
                ts: ts,
                situation: situation,
                thoughts: thoughts,
                emotions: emotions,
                reactionBody: reactionBody,
                reactionBehavior: reactionBehavior,
                evidenceFor: evidenceFor,
                evidenceAgainst: evidenceAgainst,
                reframe: reframe,
                mood: mood,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required DateTime ts,
                Value<String> situation = const Value.absent(),
                Value<String> thoughts = const Value.absent(),
                Value<String> emotions = const Value.absent(),
                Value<String> reactionBody = const Value.absent(),
                Value<String> reactionBehavior = const Value.absent(),
                Value<String> evidenceFor = const Value.absent(),
                Value<String> evidenceAgainst = const Value.absent(),
                Value<String> reframe = const Value.absent(),
                Value<int?> mood = const Value.absent(),
              }) => DiaryEntriesCompanion.insert(
                id: id,
                ts: ts,
                situation: situation,
                thoughts: thoughts,
                emotions: emotions,
                reactionBody: reactionBody,
                reactionBehavior: reactionBehavior,
                evidenceFor: evidenceFor,
                evidenceAgainst: evidenceAgainst,
                reframe: reframe,
                mood: mood,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$DiaryEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $DiaryEntriesTable,
      DiaryEntry,
      $$DiaryEntriesTableFilterComposer,
      $$DiaryEntriesTableOrderingComposer,
      $$DiaryEntriesTableAnnotationComposer,
      $$DiaryEntriesTableCreateCompanionBuilder,
      $$DiaryEntriesTableUpdateCompanionBuilder,
      (
        DiaryEntry,
        BaseReferences<_$AppDatabase, $DiaryEntriesTable, DiaryEntry>,
      ),
      DiaryEntry,
      PrefetchHooks Function()
    >;
typedef $$WinsTableCreateCompanionBuilder =
    WinsCompanion Function({
      Value<int> id,
      required DateTime ts,
      required String kind,
      required String message,
    });
typedef $$WinsTableUpdateCompanionBuilder =
    WinsCompanion Function({
      Value<int> id,
      Value<DateTime> ts,
      Value<String> kind,
      Value<String> message,
    });

class $$WinsTableFilterComposer extends Composer<_$AppDatabase, $WinsTable> {
  $$WinsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get ts => $composableBuilder(
    column: $table.ts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get message => $composableBuilder(
    column: $table.message,
    builder: (column) => ColumnFilters(column),
  );
}

class $$WinsTableOrderingComposer extends Composer<_$AppDatabase, $WinsTable> {
  $$WinsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get ts => $composableBuilder(
    column: $table.ts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get message => $composableBuilder(
    column: $table.message,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$WinsTableAnnotationComposer
    extends Composer<_$AppDatabase, $WinsTable> {
  $$WinsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get ts =>
      $composableBuilder(column: $table.ts, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get message =>
      $composableBuilder(column: $table.message, builder: (column) => column);
}

class $$WinsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $WinsTable,
          Win,
          $$WinsTableFilterComposer,
          $$WinsTableOrderingComposer,
          $$WinsTableAnnotationComposer,
          $$WinsTableCreateCompanionBuilder,
          $$WinsTableUpdateCompanionBuilder,
          (Win, BaseReferences<_$AppDatabase, $WinsTable, Win>),
          Win,
          PrefetchHooks Function()
        > {
  $$WinsTableTableManager(_$AppDatabase db, $WinsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$WinsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$WinsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$WinsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<DateTime> ts = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> message = const Value.absent(),
              }) => WinsCompanion(id: id, ts: ts, kind: kind, message: message),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required DateTime ts,
                required String kind,
                required String message,
              }) => WinsCompanion.insert(
                id: id,
                ts: ts,
                kind: kind,
                message: message,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$WinsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $WinsTable,
      Win,
      $$WinsTableFilterComposer,
      $$WinsTableOrderingComposer,
      $$WinsTableAnnotationComposer,
      $$WinsTableCreateCompanionBuilder,
      $$WinsTableUpdateCompanionBuilder,
      (Win, BaseReferences<_$AppDatabase, $WinsTable, Win>),
      Win,
      PrefetchHooks Function()
    >;
typedef $$AppSettingsRowsTableCreateCompanionBuilder =
    AppSettingsRowsCompanion Function({
      Value<int> id,
      Value<double> targetKcal,
      Value<double> targetProteinG,
      Value<double> targetFatG,
      Value<double> targetCarbG,
      Value<int> stepsGoal,
      Value<String> reminderTimes,
      Value<bool> hideCalories,
      Value<bool> llmDiaryAssist,
    });
typedef $$AppSettingsRowsTableUpdateCompanionBuilder =
    AppSettingsRowsCompanion Function({
      Value<int> id,
      Value<double> targetKcal,
      Value<double> targetProteinG,
      Value<double> targetFatG,
      Value<double> targetCarbG,
      Value<int> stepsGoal,
      Value<String> reminderTimes,
      Value<bool> hideCalories,
      Value<bool> llmDiaryAssist,
    });

class $$AppSettingsRowsTableFilterComposer
    extends Composer<_$AppDatabase, $AppSettingsRowsTable> {
  $$AppSettingsRowsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get targetKcal => $composableBuilder(
    column: $table.targetKcal,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get targetProteinG => $composableBuilder(
    column: $table.targetProteinG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get targetFatG => $composableBuilder(
    column: $table.targetFatG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get targetCarbG => $composableBuilder(
    column: $table.targetCarbG,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get stepsGoal => $composableBuilder(
    column: $table.stepsGoal,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get reminderTimes => $composableBuilder(
    column: $table.reminderTimes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get hideCalories => $composableBuilder(
    column: $table.hideCalories,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get llmDiaryAssist => $composableBuilder(
    column: $table.llmDiaryAssist,
    builder: (column) => ColumnFilters(column),
  );
}

class $$AppSettingsRowsTableOrderingComposer
    extends Composer<_$AppDatabase, $AppSettingsRowsTable> {
  $$AppSettingsRowsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get targetKcal => $composableBuilder(
    column: $table.targetKcal,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get targetProteinG => $composableBuilder(
    column: $table.targetProteinG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get targetFatG => $composableBuilder(
    column: $table.targetFatG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get targetCarbG => $composableBuilder(
    column: $table.targetCarbG,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get stepsGoal => $composableBuilder(
    column: $table.stepsGoal,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get reminderTimes => $composableBuilder(
    column: $table.reminderTimes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get hideCalories => $composableBuilder(
    column: $table.hideCalories,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get llmDiaryAssist => $composableBuilder(
    column: $table.llmDiaryAssist,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$AppSettingsRowsTableAnnotationComposer
    extends Composer<_$AppDatabase, $AppSettingsRowsTable> {
  $$AppSettingsRowsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<double> get targetKcal => $composableBuilder(
    column: $table.targetKcal,
    builder: (column) => column,
  );

  GeneratedColumn<double> get targetProteinG => $composableBuilder(
    column: $table.targetProteinG,
    builder: (column) => column,
  );

  GeneratedColumn<double> get targetFatG => $composableBuilder(
    column: $table.targetFatG,
    builder: (column) => column,
  );

  GeneratedColumn<double> get targetCarbG => $composableBuilder(
    column: $table.targetCarbG,
    builder: (column) => column,
  );

  GeneratedColumn<int> get stepsGoal =>
      $composableBuilder(column: $table.stepsGoal, builder: (column) => column);

  GeneratedColumn<String> get reminderTimes => $composableBuilder(
    column: $table.reminderTimes,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get hideCalories => $composableBuilder(
    column: $table.hideCalories,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get llmDiaryAssist => $composableBuilder(
    column: $table.llmDiaryAssist,
    builder: (column) => column,
  );
}

class $$AppSettingsRowsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $AppSettingsRowsTable,
          AppSettingsRow,
          $$AppSettingsRowsTableFilterComposer,
          $$AppSettingsRowsTableOrderingComposer,
          $$AppSettingsRowsTableAnnotationComposer,
          $$AppSettingsRowsTableCreateCompanionBuilder,
          $$AppSettingsRowsTableUpdateCompanionBuilder,
          (
            AppSettingsRow,
            BaseReferences<
              _$AppDatabase,
              $AppSettingsRowsTable,
              AppSettingsRow
            >,
          ),
          AppSettingsRow,
          PrefetchHooks Function()
        > {
  $$AppSettingsRowsTableTableManager(
    _$AppDatabase db,
    $AppSettingsRowsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$AppSettingsRowsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$AppSettingsRowsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$AppSettingsRowsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<double> targetKcal = const Value.absent(),
                Value<double> targetProteinG = const Value.absent(),
                Value<double> targetFatG = const Value.absent(),
                Value<double> targetCarbG = const Value.absent(),
                Value<int> stepsGoal = const Value.absent(),
                Value<String> reminderTimes = const Value.absent(),
                Value<bool> hideCalories = const Value.absent(),
                Value<bool> llmDiaryAssist = const Value.absent(),
              }) => AppSettingsRowsCompanion(
                id: id,
                targetKcal: targetKcal,
                targetProteinG: targetProteinG,
                targetFatG: targetFatG,
                targetCarbG: targetCarbG,
                stepsGoal: stepsGoal,
                reminderTimes: reminderTimes,
                hideCalories: hideCalories,
                llmDiaryAssist: llmDiaryAssist,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<double> targetKcal = const Value.absent(),
                Value<double> targetProteinG = const Value.absent(),
                Value<double> targetFatG = const Value.absent(),
                Value<double> targetCarbG = const Value.absent(),
                Value<int> stepsGoal = const Value.absent(),
                Value<String> reminderTimes = const Value.absent(),
                Value<bool> hideCalories = const Value.absent(),
                Value<bool> llmDiaryAssist = const Value.absent(),
              }) => AppSettingsRowsCompanion.insert(
                id: id,
                targetKcal: targetKcal,
                targetProteinG: targetProteinG,
                targetFatG: targetFatG,
                targetCarbG: targetCarbG,
                stepsGoal: stepsGoal,
                reminderTimes: reminderTimes,
                hideCalories: hideCalories,
                llmDiaryAssist: llmDiaryAssist,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$AppSettingsRowsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $AppSettingsRowsTable,
      AppSettingsRow,
      $$AppSettingsRowsTableFilterComposer,
      $$AppSettingsRowsTableOrderingComposer,
      $$AppSettingsRowsTableAnnotationComposer,
      $$AppSettingsRowsTableCreateCompanionBuilder,
      $$AppSettingsRowsTableUpdateCompanionBuilder,
      (
        AppSettingsRow,
        BaseReferences<_$AppDatabase, $AppSettingsRowsTable, AppSettingsRow>,
      ),
      AppSettingsRow,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$FoodEntriesTableTableManager get foodEntries =>
      $$FoodEntriesTableTableManager(_db, _db.foodEntries);
  $$FoodItemsTableTableManager get foodItems =>
      $$FoodItemsTableTableManager(_db, _db.foodItems);
  $$StepsDaysTableTableManager get stepsDays =>
      $$StepsDaysTableTableManager(_db, _db.stepsDays);
  $$DiaryEntriesTableTableManager get diaryEntries =>
      $$DiaryEntriesTableTableManager(_db, _db.diaryEntries);
  $$WinsTableTableManager get wins => $$WinsTableTableManager(_db, _db.wins);
  $$AppSettingsRowsTableTableManager get appSettingsRows =>
      $$AppSettingsRowsTableTableManager(_db, _db.appSettingsRows);
}
