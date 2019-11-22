<?xml version="1.0" encoding="UTF-8"?>
<schema xmlns="http://purl.oclc.org/dsdl/schematron" >
  <ns uri="http://www.blex.nl" prefix="b"/>
  <pattern id='sum-test'>
    <rule context="b:root/b:node">
      <!-- missing assert triggers error -->
    </rule>
  </pattern>
</schema>