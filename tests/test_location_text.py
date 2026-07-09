import unittest

from sevio_api.location_text import location_query_key


class LocationTextTests(unittest.TestCase):
    def test_street_type_can_be_prefix_or_suffix(self):
        self.assertEqual(location_query_key("улица Дубининская"), "дубининская")
        self.assertEqual(location_query_key("Дубининская улица"), "дубининская")
        self.assertEqual(location_query_key("ул. Дубининская"), "дубининская")

    def test_admin_descriptors_do_not_block_district_search(self):
        self.assertEqual(location_query_key("городской округ Мытищи"), "мытищи")
        self.assertEqual(location_query_key("Муниципальный Округ Даниловский"), "даниловский")

    def test_yo_and_punctuation_are_normalized(self):
        self.assertEqual(location_query_key("Щёлково"), "щелково")
        self.assertEqual(location_query_key("пр-т Мира"), "мира")


if __name__ == "__main__":
    unittest.main()
