using System;
using System.IO;
using System.Net;
using System.Text;

namespace INPClient
{
    class Program
    {
        static int Main(string[] args)
        {
            string port = args.Length > 0 ? args[0] : "3005";
            string endpoint = "http://127.0.0.1:" + port + "/api/intent";

            string dsl = "INTENT \"csharp_ecosystem\" {\n"
                + "  CONTEXT { language: \"CSharp\", iterations: 10 }\n"
                + "  REQUIRE { BENCHMARK OPS }\n"
                + "  FLOW {\n"
                + "    SEQUENCE {\n"
                + "      BENCHMARK OPS\n"
                + "    }\n"
                + "  }\n"
                + "  OUTPUT { FORMAT \"json\" }\n"
                + "}";

            string jsonPayload = "{"
                + "\"text\":\"" + dsl.Replace("\"", "\\\"").Replace("\n", "\\n") + "\","
                + "\"type\":\"dsl\","
                + "\"securityContext\":{\"userId\":\"csharp-client-01\",\"role\":\"USER\",\"permissions\":[\"*\"]}"
                + "}";

            try
            {
                var request = (HttpWebRequest)WebRequest.Create(endpoint);
                request.Method = "POST";
                request.ContentType = "application/json";
                request.Headers["X-Correlation-ID"] = "csharp-client-uuid-2026";
                request.Timeout = 10000;

                byte[] byteArray = Encoding.UTF8.GetBytes(jsonPayload);
                request.ContentLength = byteArray.Length;

                using (Stream dataStream = request.GetRequestStream())
                {
                    dataStream.Write(byteArray, 0, byteArray.Length);
                }

                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    string responseText = reader.ReadToEnd();
                    int statusCode = (int)response.StatusCode;
                    bool hasSuccess = responseText.Contains("\"success\":true");
                    bool isCompleted = responseText.Contains("\"status\":\"COMPLETED\"");

                    Console.WriteLine("{{\"language\":\"CSharp\",\"http_status\":{0},\"protocol_success\":{1},\"is_completed\":{2}}}",
                        statusCode, hasSuccess ? "true" : "false", isCompleted ? "true" : "false");

                    return (statusCode == 200 && hasSuccess && isCompleted) ? 0 : 1;
                }
            }
            catch (WebException wex)
            {
                string errorDetail = wex.Message;
                if (wex.Response != null)
                {
                    using (var errReader = new StreamReader(wex.Response.GetResponseStream()))
                    {
                        errorDetail += " - " + errReader.ReadToEnd();
                    }
                }
                Console.WriteLine("{{\"language\":\"CSharp\",\"error\":\"{0}\"}}", errorDetail.Replace("\"", "'"));
                return 1;
            }
            catch (Exception ex)
            {
                Console.WriteLine("{{\"language\":\"CSharp\",\"error\":\"{0}\"}}", ex.Message.Replace("\"", "'"));
                return 1;
            }
        }
    }
}