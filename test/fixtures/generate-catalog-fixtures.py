"""Generate tiny XLSX fixtures with Python's standard library (not needed to run tests).
Run: python test/fixtures/generate-catalog-fixtures.py
These are synthetic format examples, not engineering or pricing reference data.
"""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).parent
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
HEADERS = ['Категория', 'Название', 'Артикул', 'Цена, ₽', 'Единица', 'URL']


def workbook(name, rows, sheet='Каталог'):
    xml_rows = []
    for number, values in enumerate(rows, 1):
        cells = []
        for col, value in enumerate(values):
            if value is None:
                continue
            ref = f'{chr(65 + col)}{number}'
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        xml_rows.append(f'<row r="{number}">{"".join(cells)}</row>')
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{NS}"><sheetData>{"".join(xml_rows)}</sheetData></worksheet>',
    }
    with ZipFile(ROOT / name, 'w', ZIP_DEFLATED) as archive:
        for path, content in parts.items():
            archive.writestr(path, content)


PREAMBLE = [['Каталог san-baza.ru — тест'], ['Тестовые данные'], [], HEADERS]
A = ['Тестовая категория', 'Тестовый товар A', '001', 2.5, 'м.п.', 'https://san-baza.ru/catalog/test/1/']
B = ['Тестовая категория', 'Тестовый товар B', None, 10, 'шт', 'https://san-baza.ru/catalog/test/2/']
workbook('catalog-valid.xlsx', PREAMBLE + [A, [], B])
workbook('catalog-invalid.xlsx', PREAMBLE + [
    A,
    ['Тест', None, None, -1, 'шт', 'https://san-baza.ru/catalog/test/3/'],
    ['Тест', 'Текстовая цена', None, '12,50', 'шт', 'https://san-baza.ru/catalog/test/4/'],
    ['Тест', 'Внешний URL', None, 10, 'шт', 'https://example.com/catalog/5/'],
    ['Тест', 'Дубль URL', '002', 20, 'шт', A[5]],
    ['Тест', 'Числовой артикул', 123, 10, 'шт', 'https://san-baza.ru/catalog/test/6/'],
    ['Тест', 'Без единицы', None, 10, None, 'https://san-baza.ru/catalog/test/7/'],
])
workbook('catalog-unknown.xlsx', PREAMBLE + [
    ['Тест', 'Нет цены', 'same', None, 'шт', 'https://san-baza.ru/catalog/test/8/'],
    ['Тест', 'Нулевая цена', 'same', 0, 'шт', 'https://san-baza.ru/catalog/test/9/'],
])
workbook('catalog-header.xlsx', PREAMBLE[:3] + [['Название', 'Цена']])
workbook('catalog-sheet.xlsx', PREAMBLE + [A], sheet='Другой лист')
workbook('catalog-empty.xlsx', PREAMBLE)
workbook('catalog-partial.xlsx', PREAMBLE + [
    ['Тест обновлён', 'Товар A обновлён', '001', 3.75, 'м.п.', A[5]],
    ['Тест', 'Ошибочное обновление B', None, -10, 'шт', B[5]],
    ['Тест', 'Новый товар C', '001', 30, 'шт', 'https://san-baza.ru/catalog/test/3/'],
    ['Тест', None, None, -5, 'шт', 'https://san-baza.ru/catalog/test/4/'],
])
workbook('catalog-missing-price.xlsx', PREAMBLE + [
    ['Тест', 'Цена не указана', '001', None, 'м.п.', A[5]],
])
print('Generated eight synthetic catalog fixtures')
